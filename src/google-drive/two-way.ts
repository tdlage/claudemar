import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { join, posix } from "node:path";
import { isFileLevelError, fileErrorMessage, type DriveTree, type DriveWriter, type RemoteFile } from "./drive-api.js";
import {
  FatalSyncError,
  localFileName,
  sameContent,
  scanLocalTree,
  uniqueName,
  type LocalFile,
  type LocalTree,
  type Manifest,
  type ManifestEntry,
  type SkippedEntry,
} from "./mirror.js";

const MASS_DELETE_MIN_FILES = 20;

export interface LocalChanges {
  modified: { entry: ManifestEntry; local: LocalFile }[];
  moved: { entry: ManifestEntry; path: string; local: LocalFile }[];
  deleted: ManifestEntry[];
  created: { path: string; local: LocalFile }[];
  unsupported: string[];
  createdDirectories: string[];
  deletedDirectories: { id: string; path: string }[];
  unsettled: string[];
}

export interface PushContext {
  root: string;
  rootFolderId: string;
  tree: DriveTree;
  manifest: Manifest;
  writer: DriveWriter;
  unsyncedDir: string;
  unsyncedLabel: string;
  now: Date;
}

function parentPath(path: string): string {
  return posix.dirname(path) === "." ? "" : posix.dirname(path);
}

function isRegular(local: LocalFile): boolean {
  return local.size >= 0;
}

export function detectLocalChanges(manifest: Manifest, local: LocalTree, settledBefore: number): LocalChanges {
  const changes: LocalChanges = {
    modified: [],
    moved: [],
    deleted: [],
    created: [],
    unsupported: [],
    createdDirectories: [],
    deletedDirectories: [],
    unsettled: [],
  };
  const settled = (path: string, file: LocalFile) => {
    if (file.mtimeMs <= settledBefore) return true;
    changes.unsettled.push(path);
    return false;
  };
  const basePaths = new Set(manifest.files.map((entry) => entry.path));
  const unclaimed = new Map<number, string>();
  for (const [path, file] of local.files) {
    if (!basePaths.has(path)) unclaimed.set(file.ino, path);
  }

  for (const entry of manifest.files) {
    const current = local.files.get(entry.path);
    if (current) {
      if (!sameContent(current, entry) && settled(entry.path, current)) {
        if (isRegular(current)) changes.modified.push({ entry, local: current });
        else changes.unsupported.push(entry.path);
      }
      continue;
    }
    const movedTo = entry.ino === undefined ? undefined : unclaimed.get(entry.ino);
    const moved = movedTo === undefined ? undefined : local.files.get(movedTo);
    if (movedTo !== undefined && moved && sameContent(moved, entry)) {
      unclaimed.delete(entry.ino!);
      changes.moved.push({ entry, path: movedTo, local: moved });
    } else {
      changes.deleted.push(entry);
    }
  }

  for (const path of unclaimed.values()) {
    const file = local.files.get(path)!;
    if (!settled(path, file)) continue;
    if (isRegular(file)) changes.created.push({ path, local: file });
    else changes.unsupported.push(path);
  }

  const baseFolders = manifest.folders ?? [];
  const baseFolderPaths = new Set(baseFolders.map((folder) => folder.path));
  changes.createdDirectories = [...local.directories].filter((path) => !baseFolderPaths.has(path)).sort();
  changes.deletedDirectories = baseFolders
    .filter((folder) => !local.directories.has(folder.path))
    .sort((a, b) => b.path.length - a.path.length);
  return changes;
}

export function hasLocalChanges(changes: LocalChanges): boolean {
  return changes.modified.length + changes.moved.length + changes.deleted.length + changes.created.length
    + changes.unsupported.length + changes.createdDirectories.length + changes.deletedDirectories.length + changes.unsettled.length > 0;
}

export function isMassDeletion(changes: LocalChanges, manifest: Manifest): boolean {
  return changes.deleted.length >= MASS_DELETE_MIN_FILES && changes.deleted.length * 2 > manifest.files.length;
}

function conflictName(name: string, now: Date): string {
  const extension = posix.extname(name);
  const base = extension && extension !== name ? name.slice(0, -extension.length) : name;
  const stamp = now.toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  return `${base} (conflict copy ${stamp})${extension && extension !== name ? extension : ""}`;
}

function driveName(entry: ManifestEntry, localName: string): string {
  if (!entry.exportMimeType) return localName;
  const extension = posix.extname(localName);
  return extension && extension !== localName ? localName.slice(0, -extension.length) : localName;
}

async function siblingNames(dir: string): Promise<Set<string>> {
  return new Set(await readdir(dir).catch(() => []));
}

export async function pushLocalChanges(ctx: PushContext, changes: LocalChanges): Promise<SkippedEntry[]> {
  const notes: SkippedEntry[] = [];
  const notedAt = ctx.now.toISOString();
  const note = (path: string, reason: string, id = path): void => {
    notes.push({ id, path, reason, cause: "upload", notedAt });
  };
  const folders = (ctx.manifest.folders ??= []);
  const folderIds = new Map<string, string>([["", ctx.rootFolderId], ...folders.map((folder): [string, string] => [folder.path, folder.id])]);
  const remote = new Map(ctx.tree.files.map((file) => [file.id, file]));
  const entries = new Map(ctx.manifest.files.map((entry) => [entry.id, entry]));
  const syncManifest = () => {
    ctx.manifest.files = [...entries.values()];
  };

  const ensureFolder = async (path: string): Promise<string> => {
    const known = folderIds.get(path);
    if (known) return known;
    const parentId = await ensureFolder(parentPath(path));
    const name = posix.basename(path);
    const id = await ctx.writer.createFolder(parentId, name);
    folderIds.set(path, id);
    folders.push({ id, path });
    ctx.tree.folders.push({ id, parentId, name, createdTime: ctx.now.toISOString() });
    return id;
  };

  const remember = (path: string, file: RemoteFile, parentId: string, local: LocalFile, baseFingerprint = file.fingerprint) => {
    const entry: ManifestEntry = {
      id: file.id,
      sourceId: file.sourceId,
      path,
      fingerprint: baseFingerprint,
      size: local.size,
      mtimeMs: local.mtimeMs,
      ino: local.ino,
      readOnly: file.exportMimeType !== null,
      mimeType: file.mimeType,
      exportMimeType: file.exportMimeType,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
    };
    entries.set(file.id, entry);
    remote.set(file.id, { ...file, parentId });
    ctx.tree.files = [...ctx.tree.files.filter((existing) => existing.id !== file.id), { ...file, parentId }];
    syncManifest();
  };

  const forget = (id: string) => {
    entries.delete(id);
    remote.delete(id);
    ctx.tree.files = ctx.tree.files.filter((file) => file.id !== id);
    syncManifest();
  };

  const saveAside = async (path: string, reason: string, id?: string) => {
    const target = join(ctx.unsyncedDir, parentPath(path));
    await mkdir(target, { recursive: true });
    const name = uniqueName(posix.basename(path), await siblingNames(target));
    await rename(join(ctx.root, path), join(target, name));
    note(path, `${reason} It was moved to ${posix.join(ctx.unsyncedLabel, parentPath(path), name)}.`, id);
  };

  const run = async (operation: () => Promise<void>, onFileError: (message: string) => Promise<void>) => {
    try {
      await operation();
    } catch (err) {
      if (!isFileLevelError(err)) throw new FatalSyncError(err instanceof Error ? err.message : String(err), { cause: err });
      await onFileError(fileErrorMessage(err));
    }
  };

  const uploadNew = async (path: string, name: string, before: LocalFile) => {
    const parentId = await ensureFolder(parentPath(path));
    const file = await ctx.writer.createFile(parentId, name, join(ctx.root, path));
    remember(path, file, parentId, before);
  };

  for (const path of changes.unsupported) {
    await saveAside(path, "Only regular files are uploaded to Google Drive (links and special files are not).");
  }

  for (const entry of changes.deleted) {
    const current = remote.get(entry.id);
    if (!current) {
      forget(entry.id);
      continue;
    }
    if (current.fingerprint !== entry.fingerprint) {
      note(entry.path, "Deleted here but changed in Google Drive since the last sync, so it was kept.", entry.id);
      continue;
    }
    await run(async () => {
      await ctx.writer.trash(entry.id);
      forget(entry.id);
    }, async (message) => note(entry.path, `Could not delete it in Google Drive: ${message}`, entry.id));
  }

  for (const { entry, path, local } of changes.moved) {
    const current = remote.get(entry.id);
    if (!current) {
      await run(async () => {
        forget(entry.id);
        await uploadNew(path, posix.basename(path), local);
      }, (message) => saveAside(path, `Could not upload it: ${message}.`));
      continue;
    }
    await run(async () => {
      const toParentId = await ensureFolder(parentPath(path));
      const moved = await ctx.writer.move(entry.id, driveName(entry, posix.basename(path)), current.parentId, toParentId);
      remember(path, moved, toParentId, local, entry.fingerprint === current.fingerprint ? moved.fingerprint : entry.fingerprint);
    }, async (message) => note(path, `Could not rename or move it in Google Drive: ${message}`, entry.id));
  }

  for (const { entry, local } of changes.modified) {
    const current = remote.get(entry.id);
    if (entry.readOnly) {
      await saveAside(entry.path, "Copies of Google Docs, Sheets, Slides, Drawings and shortcuts are read-only (edit Google Docs, Sheets and Slides with the gdrive tools), so this edit was not uploaded.", entry.id);
      continue;
    }
    if (current && current.fingerprint === entry.fingerprint) {
      await run(async () => {
        const updated = await ctx.writer.updateContent(entry.id, join(ctx.root, entry.path));
        remember(entry.path, updated, current.parentId, local);
      }, (message) => saveAside(entry.path, `Could not upload the new version: ${message}.`, entry.id));
      continue;
    }
    if (current) {
      const directory = join(ctx.root, parentPath(entry.path));
      const copyName = uniqueName(localFileName(conflictName(posix.basename(entry.path), ctx.now)), await siblingNames(directory));
      const copyPath = posix.join(parentPath(entry.path), copyName);
      await run(async () => {
        await rename(join(ctx.root, entry.path), join(ctx.root, copyPath));
        await uploadNew(copyPath, copyName, local);
        note(entry.path, `Changed both here and in Google Drive: this version was uploaded as "${copyName}".`, entry.id);
      }, (message) => saveAside(copyPath, `Changed both here and in Google Drive and the agent version could not be uploaded: ${message}.`));
      continue;
    }
    await run(async () => {
      forget(entry.id);
      await uploadNew(entry.path, posix.basename(entry.path), local);
      note(entry.path, "It had been deleted in Google Drive, so it was uploaded again.");
    }, (message) => saveAside(entry.path, `Could not upload it: ${message}.`));
  }

  for (const { path, local } of changes.created) {
    await run(() => uploadNew(path, posix.basename(path), local), (message) => saveAside(path, `Could not upload it: ${message}.`));
  }

  for (const path of changes.createdDirectories) {
    await run(async () => {
      await ensureFolder(path);
    }, async (message) => note(path, `Could not create the folder in Google Drive: ${message}`));
  }

  for (const folder of changes.deletedDirectories) {
    const hasChildren = ctx.tree.files.some((file) => file.parentId === folder.id) || ctx.tree.folders.some((child) => child.parentId === folder.id);
    if (hasChildren) {
      note(folder.path, "Deleted here but it still has files in Google Drive, so the folder was kept.", folder.id);
      continue;
    }
    await run(async () => {
      await ctx.writer.trash(folder.id);
      ctx.tree.folders = ctx.tree.folders.filter((existing) => existing.id !== folder.id);
      ctx.manifest.folders = (ctx.manifest.folders ?? []).filter((existing) => existing.id !== folder.id);
    }, async (message) => note(folder.path, `Could not delete the folder in Google Drive: ${message}`, folder.id));
  }

  syncManifest();
  return notes;
}

export async function salvageAfterSwap(
  trashDir: string,
  snapshot: LocalTree,
  root: string,
  unsyncedDir: string,
): Promise<string[]> {
  const leftovers = await scanLocalTree(trashDir);
  const rescued: string[] = [];
  if (!leftovers) return rescued;
  for (const [path, file] of leftovers.files) {
    const known = snapshot.files.get(path);
    if (known && known.ino === file.ino && sameContent(file, known)) continue;
    const occupied = await lstat(join(root, path)).then(() => true, () => false);
    const destinationRoot = occupied ? unsyncedDir : root;
    await mkdir(join(destinationRoot, parentPath(path)), { recursive: true });
    await rename(join(trashDir, path), join(destinationRoot, path));
    rescued.push(path);
  }
  return rescued;
}
