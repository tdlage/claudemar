import { createHash, randomBytes } from "node:crypto";
import { copyFile, link, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, posix } from "node:path";
import { formatSize, truncateUtf8 } from "../byte-utils.js";

export interface MirrorFolder {
  id: string;
  parentId: string;
  name: string;
  createdTime: string | null;
}

export interface MirrorFile {
  id: string;
  sourceId: string;
  parentId: string;
  name: string;
  extension: string;
  fingerprint: string;
  revision: string;
  size: number | null;
  mimeType: string;
  exportMimeType: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
}

export interface TreeSkip {
  id: string;
  parentId: string;
  name: string;
  reason: string;
}

export interface PlannedFile extends MirrorFile {
  path: string;
}

export type SkipCause = "file-size" | "folder-size" | "download";

export interface SkippedEntry {
  id: string;
  path: string;
  reason: string;
  cause?: SkipCause;
  retryKey?: string;
  size?: number;
  keptPrevious?: boolean;
}

export interface MirrorPlan {
  directories: string[];
  files: PlannedFile[];
  skipped: SkippedEntry[];
}

export interface ManifestEntry {
  id: string;
  path: string;
  fingerprint: string;
  size: number;
  mtimeMs: number;
  mimeType: string;
  exportMimeType: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
}

export interface Manifest {
  files: ManifestEntry[];
  skipped: SkippedEntry[];
  signature: string | null;
}

export interface MirrorOptions {
  root: string;
  workDir: string;
  key: string;
  plan: MirrorPlan;
  previous: Manifest;
  download: (file: PlannedFile, destination: string) => Promise<void>;
  concurrency: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  retrySkipped?: boolean;
  signal?: AbortSignal;
  canCommit?: () => boolean;
}

export interface MirrorResult {
  files: ManifestEntry[];
  skipped: SkippedEntry[];
  totalBytes: number;
  changed: boolean;
  signature: string;
}

export class FatalSyncError extends Error {}

export class MirrorAbortedError extends Error {}

const MAX_NAME_BYTES = 240;
const MAX_EXTENSION_BYTES = 32;
const LINK_FALLBACK_CODES = new Set(["EXDEV", "EPERM", "EMLINK", "ENOTSUP", "EOPNOTSUPP"]);

export const emptyManifest = (): Manifest => ({ files: [], skipped: [], signature: null });

function splitExtension(name: string): [string, string] {
  const extension = extname(name);
  if (!extension || extension === name || Buffer.byteLength(extension) > MAX_EXTENSION_BYTES) return [name, ""];
  return [name.slice(0, -extension.length), extension];
}

export function localFileName(raw: string, extension = ""): string {
  let name = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim() || "untitled";
  if (extension && !name.toLowerCase().endsWith(extension.toLowerCase())) name += extension;
  if (name === "." || name === "..") name = name.replace(/\./g, "_");
  const [base, ext] = splitExtension(name);
  return truncateUtf8(base, MAX_NAME_BYTES - Buffer.byteLength(ext)) + ext;
}

export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  if (taken.has(candidate)) {
    const [base, ext] = splitExtension(name);
    for (let n = 2; taken.has(candidate); n++) {
      const suffix = ` (${n})`;
      candidate = truncateUtf8(base, MAX_NAME_BYTES - Buffer.byteLength(suffix + ext)) + suffix + ext;
    }
  }
  taken.add(candidate);
  return candidate;
}

export function linkDirectoryName(folderName: string, taken: Set<string>): string {
  return uniqueName(localFileName(folderName).replace(/^\./, "_"), taken);
}

function byCreation(a: { id: string; createdTime: string | null }, b: { id: string; createdTime: string | null }): number {
  const left = a.createdTime ?? "";
  const right = b.createdTime ?? "";
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function groupByParent<T extends { parentId: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.parentId);
    if (group) group.push(item);
    else groups.set(item.parentId, [item]);
  }
  return groups;
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path.localeCompare(b.path);
}

export function planMirror(rootId: string, folders: MirrorFolder[], files: MirrorFile[], skipped: TreeSkip[] = []): MirrorPlan {
  const subfolders = groupByParent(folders);
  const folderFiles = groupByParent(files);
  const folderPaths = new Map<string, string>([[rootId, ""]]);
  const plan: MirrorPlan = { directories: [], files: [], skipped: [] };
  const visit = (folderId: string, base: string) => {
    const taken = new Set<string>();
    const children = (subfolders.get(folderId) ?? [])
      .sort(byCreation)
      .map((folder) => ({ folder, path: posix.join(base, uniqueName(localFileName(folder.name), taken)) }));
    for (const file of (folderFiles.get(folderId) ?? []).sort(byCreation)) {
      plan.files.push({ ...file, path: posix.join(base, uniqueName(localFileName(file.name, file.extension), taken)) });
    }
    for (const child of children) {
      plan.directories.push(child.path);
      folderPaths.set(child.folder.id, child.path);
      visit(child.folder.id, child.path);
    }
  };
  visit(rootId, "");
  plan.skipped = skipped
    .map((entry) => ({ id: entry.id, path: posix.join(folderPaths.get(entry.parentId) ?? "", localFileName(entry.name)), reason: entry.reason }))
    .sort(byPath);
  return plan;
}

function planSignature(plan: MirrorPlan, options: MirrorOptions): string {
  const content = JSON.stringify([
    options.maxFileBytes,
    options.maxTotalBytes,
    plan.directories,
    plan.files.map((file) => [file.id, file.path, file.fingerprint, file.revision]),
  ]);
  return createHash("sha256").update(content).digest("hex");
}

function retryKey(file: PlannedFile, options: MirrorOptions): string {
  return `${file.fingerprint}|${file.revision}|${options.maxFileBytes}`;
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function intact(root: string, entry: ManifestEntry): Promise<boolean> {
  try {
    const info = await lstat(join(root, entry.path));
    return info.isFile() && info.size === entry.size && Math.trunc(info.mtimeMs) === Math.trunc(entry.mtimeMs);
  } catch {
    return false;
  }
}

async function scan(root: string): Promise<{ files: Set<string>; directories: Set<string> } | null> {
  const files = new Set<string>();
  const directories = new Set<string>();
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.add(path);
        await walk(join(dir, entry.name), path);
      } else {
        files.add(path);
      }
    }
  };
  try {
    await walk(root, "");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
  return { files, directories };
}

function sameSet(a: Set<string>, b: string[]): boolean {
  return a.size === b.length && b.every((value) => a.has(value));
}

async function mirrorIntact(root: string, entries: ManifestEntry[], directories: string[]): Promise<boolean> {
  const disk = await scan(root);
  if (!disk || !sameSet(disk.files, entries.map((entry) => entry.path)) || !sameSet(disk.directories, directories)) return false;
  for (const entry of entries) {
    if (!(await intact(root, entry))) return false;
  }
  return true;
}

function toEntry(file: PlannedFile, size: number, mtimeMs: number, fingerprint = file.fingerprint): ManifestEntry {
  return {
    id: file.id,
    path: file.path,
    fingerprint,
    size,
    mtimeMs,
    mimeType: file.mimeType,
    exportMimeType: file.exportMimeType,
    modifiedTime: file.modifiedTime,
    webViewLink: file.webViewLink,
  };
}

async function linkOrCopy(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch (err) {
    if (!LINK_FALLBACK_CODES.has(errorCode(err) ?? "")) throw err;
    await copyFile(source, destination);
  }
}

async function forEachLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failures.length > 0) throw failures[0];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MirrorAbortedError("Sync cancelled");
}

async function removeLeftovers(workDir: string, key: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(workDir);
  } catch {
    return;
  }
  const prefixes = [`.staging-${key}`, `.trash-${key}-`];
  await Promise.all(
    names
      .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
      .map((name) => rm(join(workDir, name), { recursive: true, force: true })),
  );
}

async function swapInto(staging: string, root: string, workDir: string, key: string): Promise<void> {
  await mkdir(dirname(root), { recursive: true });
  const trash = join(workDir, `.trash-${key}-${randomBytes(4).toString("hex")}`);
  let replaced = false;
  try {
    await rename(root, trash);
    replaced = true;
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
  }
  try {
    await rename(staging, root);
  } catch (err) {
    if (replaced) await rename(trash, root).catch(() => {});
    throw err;
  }
  if (replaced) await rm(trash, { recursive: true, force: true });
}

export async function applyMirror(options: MirrorOptions): Promise<MirrorResult> {
  const { root, plan, previous } = options;
  await removeLeftovers(options.workDir, options.key);
  const signature = planSignature(plan, options);
  const previousSkips = previous.skipped.filter((entry) => entry.cause !== undefined);

  if (!options.retrySkipped && previous.signature === signature && (await mirrorIntact(root, previous.files, plan.directories))) {
    const planned = new Map(plan.files.map((file) => [file.id, file]));
    const files = previous.files.map((entry) => {
      const file = planned.get(entry.id);
      return file ? toEntry(file, entry.size, entry.mtimeMs, entry.fingerprint) : entry;
    });
    return { files, skipped: previousSkips, totalBytes: files.reduce((sum, entry) => sum + entry.size, 0), changed: false, signature };
  }

  const previousById = new Map(previous.files.map((entry) => [entry.id, entry]));
  const reusable = new Map<string, ManifestEntry>();
  for (const file of plan.files) {
    const entry = previousById.get(file.id);
    if (entry && entry.fingerprint === file.fingerprint && (await intact(root, entry))) reusable.set(file.id, entry);
  }
  const remembered = new Map(options.retrySkipped ? [] : previousSkips.map((entry) => [entry.id, entry]));

  const staging = join(options.workDir, `.staging-${options.key}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const directory of plan.directories) await mkdir(join(staging, directory), { recursive: true });
    const files: ManifestEntry[] = [];
    const skipped: SkippedEntry[] = [];
    let totalBytes = 0;
    const fits = (bytes: number) => options.maxTotalBytes <= 0 || totalBytes + bytes <= options.maxTotalBytes;
    const tooLarge = `Larger than the ${formatSize(options.maxFileBytes)} file limit`;
    const folderLimit = `Folder size limit (${formatSize(options.maxTotalBytes)}) reached`;

    const place = async (file: PlannedFile, source: ManifestEntry, destination: string, fingerprint?: string) => {
      await linkOrCopy(join(root, source.path), destination);
      const info = await stat(destination);
      files.push(toEntry(file, info.size, info.mtimeMs, fingerprint));
    };

    const keepPreviousOrSkip = async (file: PlannedFile, destination: string, key: string, reason: string) => {
      const stale = previousById.get(file.id);
      if (stale && fits(stale.size) && (await intact(root, stale))) {
        totalBytes += stale.size;
        await place(file, stale, destination, stale.fingerprint);
        skipped.push({ id: file.id, path: file.path, reason, cause: "download", retryKey: key, keptPrevious: true });
        return;
      }
      skipped.push({ id: file.id, path: file.path, reason, cause: "download", retryKey: key });
    };

    await forEachLimit(plan.files, options.concurrency, async (file) => {
      throwIfAborted(options.signal);
      const destination = join(staging, file.path);
      const key = retryKey(file, options);
      const kept = reusable.get(file.id);
      const memo = remembered.get(file.id);
      const known = memo?.retryKey === key ? memo : undefined;
      const knownSize = file.size ?? kept?.size ?? known?.size ?? null;
      const sized = knownSize === null ? {} : { size: knownSize };
      if (knownSize !== null && options.maxFileBytes > 0 && knownSize > options.maxFileBytes) {
        skipped.push({ id: file.id, path: file.path, reason: tooLarge, cause: "file-size", retryKey: key, ...sized });
        return;
      }
      const expected = knownSize ?? 0;
      if (!fits(expected)) {
        skipped.push({ id: file.id, path: file.path, reason: folderLimit, cause: "folder-size", retryKey: key, ...sized });
        return;
      }
      if (kept) {
        totalBytes += expected;
        await place(file, kept, destination);
        return;
      }
      if (known?.cause === "download") {
        await keepPreviousOrSkip(file, destination, key, known.reason);
        return;
      }
      totalBytes += expected;
      try {
        await options.download(file, destination);
      } catch (err) {
        totalBytes -= expected;
        await rm(destination, { force: true });
        if (err instanceof FatalSyncError || options.signal?.aborted) throw err;
        await keepPreviousOrSkip(file, destination, key, errorMessage(err));
        return;
      }
      const info = await stat(destination);
      totalBytes += info.size - expected;
      const overFile = options.maxFileBytes > 0 && info.size > options.maxFileBytes;
      if (overFile || (options.maxTotalBytes > 0 && totalBytes > options.maxTotalBytes)) {
        totalBytes -= info.size;
        await rm(destination, { force: true });
        skipped.push({ id: file.id, path: file.path, reason: overFile ? tooLarge : folderLimit, cause: overFile ? "file-size" : "folder-size", retryKey: key, size: info.size });
        return;
      }
      files.push(toEntry(file, info.size, info.mtimeMs));
    });

    throwIfAborted(options.signal);
    if (options.canCommit && !options.canCommit()) throw new MirrorAbortedError("Folder was disconnected during the sync");
    await swapInto(staging, root, options.workDir, options.key);
    files.sort(byPath);
    skipped.sort(byPath);
    return { files, skipped, totalBytes, changed: true, signature };
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}

export async function removeMirror(root: string, workDir: string, key: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await removeLeftovers(workDir, key);
}

export async function readManifest(path: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<Manifest>;
    return {
      files: Array.isArray(parsed.files) ? parsed.files : [],
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      signature: typeof parsed.signature === "string" ? parsed.signature : null,
    };
  } catch (err) {
    if (errorCode(err) === "ENOENT" || err instanceof SyntaxError) return emptyManifest();
    throw err;
  }
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest), { mode: 0o600 });
  await rename(tmp, path);
}
