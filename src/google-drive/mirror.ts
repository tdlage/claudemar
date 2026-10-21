import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, link, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

export type SkipCause = "file-size" | "folder-size" | "download" | "upload";

const MIRROR_SKIP_CAUSES = new Set<SkipCause>(["file-size", "folder-size", "download"]);

export interface SkippedEntry {
  id: string;
  path: string;
  reason: string;
  cause?: SkipCause;
  retryKey?: string;
  size?: number;
  keptPrevious?: boolean;
  notedAt?: string;
}

export interface FolderEntry {
  id: string;
  path: string;
}

export interface MirrorPlan {
  directories: string[];
  folders: FolderEntry[];
  files: PlannedFile[];
  skipped: SkippedEntry[];
}

export interface ManifestEntry {
  id: string;
  path: string;
  fingerprint: string;
  size: number;
  mtimeMs: number;
  ino?: number;
  readOnly?: boolean;
  mimeType: string;
  exportMimeType: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
}

export interface Manifest {
  files: ManifestEntry[];
  skipped: SkippedEntry[];
  folders?: FolderEntry[];
  signature: string | null;
  baseline?: boolean;
}

export interface LocalFile {
  size: number;
  mtimeMs: number;
  ino: number;
}

export interface LocalTree {
  files: Map<string, LocalFile>;
  directories: Set<string>;
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
  beforeCommit?: () => Promise<void>;
  salvage?: (trashDir: string) => Promise<void>;
  fileMode?: (entry: ManifestEntry) => number;
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
  const plan: MirrorPlan = { directories: [], folders: [], files: [], skipped: [] };
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
      plan.folders.push({ id: child.folder.id, path: child.path });
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

export function sameContent(local: LocalFile | undefined, entry: Pick<ManifestEntry, "size" | "mtimeMs">): boolean {
  return local !== undefined && local.size === entry.size && Math.trunc(local.mtimeMs) === Math.trunc(entry.mtimeMs);
}

async function intact(root: string, entry: ManifestEntry): Promise<boolean> {
  try {
    const info = await lstat(join(root, entry.path));
    return info.isFile() && sameContent(info, entry);
  } catch {
    return false;
  }
}

export async function scanLocalTree(root: string): Promise<LocalTree | null> {
  const tree: LocalTree = { files: new Map(), directories: new Set() };
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        tree.directories.add(path);
        await walk(absolute, path);
      } else {
        const info = await lstat(absolute);
        tree.files.set(path, { size: info.isFile() ? info.size : -1, mtimeMs: info.mtimeMs, ino: info.ino });
      }
    }
  };
  try {
    await walk(root, "");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return null;
    throw err;
  }
  return tree;
}

export function sameLocalTree(a: LocalTree | null, b: LocalTree | null): boolean {
  if (!a || !b) return a === b;
  if (a.files.size !== b.files.size || a.directories.size !== b.directories.size) return false;
  for (const directory of a.directories) if (!b.directories.has(directory)) return false;
  for (const [path, file] of a.files) {
    const other = b.files.get(path);
    if (!other || other.ino !== file.ino || !sameContent(other, file)) return false;
  }
  return true;
}

function sameSet(a: Iterable<string>, b: string[]): boolean {
  const set = new Set(a);
  return set.size === b.length && b.every((value) => set.has(value));
}

async function mirrorIntact(root: string, entries: ManifestEntry[], directories: string[]): Promise<LocalTree | null> {
  const disk = await scanLocalTree(root);
  if (!disk || !sameSet(disk.files.keys(), entries.map((entry) => entry.path)) || !sameSet(disk.directories, directories)) return null;
  return entries.every((entry) => sameContent(disk.files.get(entry.path), entry)) ? disk : null;
}

function toEntry(file: PlannedFile, info: LocalFile, fingerprint = file.fingerprint): ManifestEntry {
  return {
    id: file.id,
    path: file.path,
    fingerprint,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ino: info.ino,
    readOnly: file.exportMimeType !== null || file.sourceId !== file.id,
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

async function applyModes(root: string, entries: ManifestEntry[], fileMode: (entry: ManifestEntry) => number): Promise<void> {
  for (const entry of entries) {
    const path = join(root, entry.path);
    const mode = fileMode(entry);
    if (((await lstat(path)).mode & 0o777) !== mode) await chmod(path, mode);
  }
}

async function swapInto(staging: string, root: string, workDir: string, key: string, salvage?: (trashDir: string) => Promise<void>): Promise<void> {
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
  if (!replaced) return;
  if (salvage) await salvage(trash);
  await rm(trash, { recursive: true, force: true });
}

export async function applyMirror(options: MirrorOptions): Promise<MirrorResult> {
  const { root, plan, previous } = options;
  await removeLeftovers(options.workDir, options.key);
  const signature = planSignature(plan, options);
  const previousSkips = previous.skipped.filter((entry) => entry.cause !== undefined && MIRROR_SKIP_CAUSES.has(entry.cause));

  const disk = !options.retrySkipped && previous.signature === signature ? await mirrorIntact(root, previous.files, plan.directories) : null;
  if (disk) {
    const planned = new Map(plan.files.map((file) => [file.id, file]));
    const files = previous.files.map((entry) => {
      const file = planned.get(entry.id);
      return file ? toEntry(file, disk.files.get(entry.path)!, entry.fingerprint) : entry;
    });
    if (options.fileMode) await applyModes(root, files, options.fileMode);
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
      files.push(toEntry(file, await stat(destination), fingerprint));
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
      files.push(toEntry(file, info));
    });

    throwIfAborted(options.signal);
    if (options.fileMode) await applyModes(staging, files, options.fileMode);
    if (options.canCommit && !options.canCommit()) throw new MirrorAbortedError("Folder was disconnected during the sync");
    if (options.beforeCommit) await options.beforeCommit();
    await swapInto(staging, root, options.workDir, options.key, options.salvage);
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
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      signature: typeof parsed.signature === "string" ? parsed.signature : null,
      baseline: parsed.baseline === true || typeof parsed.signature === "string",
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
