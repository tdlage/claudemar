import { createWriteStream } from "node:fs";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { byteLimiter, formatSize } from "../byte-utils.js";
import type { MirrorFile, MirrorFolder, TreeSkip } from "./mirror.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const NATIVE_PREFIX = "application/vnd.google-apps.";
const METADATA_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const ITEM_FIELDS = "id,name,mimeType,size,md5Checksum,version,createdTime,modifiedTime,webViewLink,trashed,capabilities(canDownload),shortcutDetails(targetId,targetMimeType)";
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded", "sharingRateLimitExceeded"]);

const EXPORT_FORMATS: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { mimeType: "text/markdown", extension: ".md" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" },
  "application/vnd.google-apps.presentation": { mimeType: "application/pdf", extension: ".pdf" },
  "application/vnd.google-apps.drawing": { mimeType: "image/png", extension: ".png" },
  "application/vnd.google-apps.script": { mimeType: "application/vnd.google-apps.script+json", extension: ".json" },
};

const FILE_ERROR_MESSAGES: Record<string, string> = {
  exportSizeLimitExceeded: "Google Drive only exports Google files up to 10 MB",
  cannotDownloadAbusiveFile: "Google flagged this file as malware or spam",
  cannotDownloadFile: "The owner disabled downloading this file",
  cannotExportFile: "The owner disabled downloading this file",
  notFound: "The file was removed while syncing",
};

export const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export interface DriveFolderInfo {
  id: string;
  name: string;
  driveId: string | null;
  trashed: boolean;
}

export type BrowseScope = "my" | "shared" | "drives";

export interface BrowseRequest {
  scope: BrowseScope;
  parentId: string | null;
  driveId: string | null;
  search: string | null;
  pageToken: string | null;
}

export interface BrowseFolder {
  id: string;
  name: string;
  driveId: string | null;
}

export interface BrowseResult {
  folders: BrowseFolder[];
  nextPageToken: string | null;
}

export interface DriveTree {
  folders: MirrorFolder[];
  files: MirrorFile[];
  skipped: TreeSkip[];
  truncated: boolean;
}

export interface DriveChange {
  fileId: string | null;
  parents: string[];
}

export function changeAffects(index: Set<string>, change: DriveChange): boolean {
  return (change.fileId !== null && index.has(change.fileId)) || change.parents.some((parent) => index.has(parent));
}

export interface DriveErrorInfo {
  status: number | null;
  reason: string | null;
  message: string;
}

export class FileTooLargeError extends Error {}

export function driveClient(auth: OAuth2Client): drive_v3.Drive {
  return google.drive({ version: "v3", auth });
}

export function driveErrorInfo(err: unknown): DriveErrorInfo {
  const source = err as { status?: unknown; message?: unknown; response?: { status?: unknown; data?: unknown } } | null;
  const status = typeof source?.status === "number"
    ? source.status
    : typeof source?.response?.status === "number" ? source.response.status : null;
  let data = source?.response?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = undefined;
    }
  }
  const body = data as { error?: unknown; error_description?: unknown } | undefined;
  const fallback = err instanceof Error ? err.message : String(err);
  if (typeof body?.error === "string") {
    return { status, reason: body.error, message: typeof body.error_description === "string" ? body.error_description : body.error };
  }
  const error = body?.error as { message?: unknown; errors?: { reason?: unknown }[] } | undefined;
  const reason = error?.errors?.find((e) => typeof e.reason === "string")?.reason;
  return {
    status,
    reason: typeof reason === "string" ? reason : null,
    message: typeof error?.message === "string" ? error.message : fallback,
  };
}

export function isFileLevelError(err: unknown): boolean {
  if (err instanceof FileTooLargeError) return true;
  const { status, reason } = driveErrorInfo(err);
  if (reason && RATE_LIMIT_REASONS.has(reason)) return false;
  return status !== null && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

function isNotFound(err: unknown): boolean {
  return driveErrorInfo(err).status === 404;
}

function isInaccessibleTarget(err: unknown): boolean {
  const { status, reason } = driveErrorInfo(err);
  return status === 404 || (status === 403 && !(reason && RATE_LIMIT_REASONS.has(reason)));
}

export function fileErrorMessage(err: unknown): string {
  if (err instanceof FileTooLargeError) return err.message;
  const { reason, message } = driveErrorInfo(err);
  return (reason && FILE_ERROR_MESSAGES[reason]) || message;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function getFolder(drive: drive_v3.Drive, folderId: string, signal?: AbortSignal): Promise<DriveFolderInfo | null> {
  try {
    const { data } = await drive.files.get(
      { fileId: folderId, fields: "id,name,mimeType,driveId,trashed", supportsAllDrives: true },
      { signal, timeout: METADATA_TIMEOUT_MS },
    );
    if (!data.id || data.mimeType !== FOLDER_MIME) return null;
    let name = data.name || data.id;
    if (data.driveId && data.id === data.driveId) {
      const { data: sharedDrive } = await drive.drives.get({ driveId: data.driveId, fields: "name" }, { signal, timeout: METADATA_TIMEOUT_MS });
      name = sharedDrive.name || name;
    }
    return { id: data.id, name, driveId: data.driveId ?? null, trashed: data.trashed === true };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function browseFolders(drive: drive_v3.Drive, request: BrowseRequest): Promise<BrowseResult> {
  const pageToken = request.pageToken ?? undefined;
  if (request.scope === "drives" && !request.parentId && !request.search) {
    const { data } = await drive.drives.list(
      { pageSize: 100, pageToken, fields: "nextPageToken,drives(id,name)" },
      { timeout: METADATA_TIMEOUT_MS },
    );
    return {
      folders: (data.drives ?? []).flatMap((d) => (d.id ? [{ id: d.id, name: d.name || d.id, driveId: d.id }] : [])),
      nextPageToken: data.nextPageToken ?? null,
    };
  }

  const clauses = [`mimeType = '${FOLDER_MIME}'`, "trashed = false"];
  const params: drive_v3.Params$Resource$Files$List = {
    pageSize: 200,
    pageToken,
    fields: "nextPageToken,files(id,name,driveId)",
    orderBy: "name_natural",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  };
  if (request.search) {
    clauses.push(`name contains '${escapeQuery(request.search)}'`);
    params.corpora = "allDrives";
  } else if (request.parentId) {
    clauses.push(`'${request.parentId}' in parents`);
    if (request.driveId) {
      params.corpora = "drive";
      params.driveId = request.driveId;
    }
  } else if (request.scope === "shared") {
    clauses.push("sharedWithMe = true");
  } else {
    clauses.push("'root' in parents");
  }
  params.q = clauses.join(" and ");

  const { data } = await drive.files.list(params, { timeout: METADATA_TIMEOUT_MS });
  return {
    folders: (data.files ?? []).flatMap((f) => (f.id ? [{ id: f.id, name: f.name || f.id, driveId: f.driveId ?? null }] : [])),
    nextPageToken: data.nextPageToken ?? null,
  };
}

const NATIVE_TYPE_LABELS: Record<string, string> = {
  form: "Google Forms",
  site: "Google Sites",
  map: "Google My Maps",
  jam: "Jamboard",
  vid: "Google Vids",
  fusiontable: "Fusion Tables",
};

function nativeTypeLabel(mimeType: string): string {
  const type = mimeType.slice(NATIVE_PREFIX.length);
  return NATIVE_TYPE_LABELS[type] ?? `Google "${type || "unknown"}"`;
}

async function resolveItem(
  drive: drive_v3.Drive,
  item: drive_v3.Schema$File,
  signal: AbortSignal | undefined,
): Promise<Omit<MirrorFile, "parentId"> | { reason: string }> {
  let source = item;
  if (item.mimeType === SHORTCUT_MIME) {
    const targetId = item.shortcutDetails?.targetId;
    if (!targetId) return { reason: "Shortcut without a target" };
    if (item.shortcutDetails?.targetMimeType === FOLDER_MIME) return { reason: "Shortcuts to folders are not followed" };
    try {
      ({ data: source } = await drive.files.get(
        { fileId: targetId, fields: ITEM_FIELDS, supportsAllDrives: true },
        { signal, timeout: METADATA_TIMEOUT_MS },
      ));
    } catch (err) {
      if (isInaccessibleTarget(err)) return { reason: "The shortcut target is not accessible" };
      throw err;
    }
    if (source.trashed) return { reason: "The shortcut target is in the trash" };
  }

  const mimeType = source.mimeType || "application/octet-stream";
  let extension = "";
  let exportMimeType: string | null = null;
  if (mimeType.startsWith(NATIVE_PREFIX)) {
    const format = EXPORT_FORMATS[mimeType];
    if (!format) return { reason: `${nativeTypeLabel(mimeType)} files cannot be downloaded` };
    extension = format.extension;
    exportMimeType = format.mimeType;
  }
  if (source.capabilities?.canDownload === false) return { reason: "The owner disabled downloading this file" };

  const revision = source.version ?? source.modifiedTime ?? "";
  const fingerprint = exportMimeType
    ? `export:${exportMimeType}:${revision}`
    : source.md5Checksum ? `md5:${source.md5Checksum}` : `version:${revision}`;
  const id = item.id as string;
  return {
    id,
    sourceId: source.id || id,
    name: item.name || source.name || id,
    extension,
    fingerprint,
    revision,
    size: !exportMimeType && source.size ? Number(source.size) : null,
    mimeType,
    exportMimeType,
    createdTime: item.createdTime ?? null,
    modifiedTime: source.modifiedTime ?? null,
    webViewLink: source.webViewLink ?? item.webViewLink ?? null,
  };
}

export async function listFolderTree(
  drive: drive_v3.Drive,
  root: { id: string; driveId: string | null },
  options: { maxFiles: number; signal?: AbortSignal },
): Promise<DriveTree> {
  const tree: DriveTree = { folders: [], files: [], skipped: [], truncated: false };
  const visited = new Set([root.id]);
  const seen = new Set<string>();
  const queue = [root.id];
  while (queue.length > 0) {
    const folderId = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const { data } = await drive.files.list(
        {
          q: `'${folderId}' in parents and trashed = false`,
          fields: `nextPageToken,incompleteSearch,files(${ITEM_FIELDS})`,
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          ...(root.driveId ? { corpora: "drive", driveId: root.driveId } : {}),
        },
        { signal: options.signal, timeout: METADATA_TIMEOUT_MS },
      );
      if (data.incompleteSearch) throw new Error("Google Drive returned an incomplete folder listing; the sync was stopped to avoid removing files");
      for (const item of data.files ?? []) {
        if (!item.id) continue;
        const name = item.name || item.id;
        if (item.mimeType === FOLDER_MIME) {
          if (visited.has(item.id)) continue;
          visited.add(item.id);
          tree.folders.push({ id: item.id, parentId: folderId, name, createdTime: item.createdTime ?? null });
          queue.push(item.id);
          continue;
        }
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (options.maxFiles > 0 && tree.files.length >= options.maxFiles) {
          tree.truncated = true;
          return tree;
        }
        const resolved = await resolveItem(drive, item, options.signal);
        if ("reason" in resolved) tree.skipped.push({ id: item.id, parentId: folderId, name, reason: resolved.reason });
        else tree.files.push({ ...resolved, parentId: folderId });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return tree;
}

export async function downloadFile(
  drive: drive_v3.Drive,
  file: Pick<MirrorFile, "sourceId" | "exportMimeType">,
  destination: string,
  options: { maxBytes: number; signal?: AbortSignal },
): Promise<void> {
  const request = { responseType: "stream" as const, signal: options.signal, timeout: DOWNLOAD_TIMEOUT_MS };
  const response = file.exportMimeType
    ? await drive.files.export({ fileId: file.sourceId, mimeType: file.exportMimeType }, request)
    : await drive.files.get({ fileId: file.sourceId, alt: "media", supportsAllDrives: true }, request);
  const body: Readable = response.data;
  if (options.maxBytes > 0) {
    const limiter = byteLimiter(options.maxBytes, () => new FileTooLargeError(`Larger than the ${formatSize(options.maxBytes)} file limit`));
    await pipeline(body, limiter, createWriteStream(destination));
  } else {
    await pipeline(body, createWriteStream(destination));
  }
}

export async function getStartPageToken(drive: drive_v3.Drive): Promise<string> {
  const { data } = await drive.changes.getStartPageToken({ supportsAllDrives: true }, { timeout: METADATA_TIMEOUT_MS });
  if (!data.startPageToken) throw new Error("Google Drive did not return a change token");
  return data.startPageToken;
}

export async function listChanges(drive: drive_v3.Drive, startPageToken: string): Promise<{ changes: DriveChange[]; nextStartPageToken: string }> {
  const changes: DriveChange[] = [];
  let pageToken = startPageToken;
  for (;;) {
    const { data } = await drive.changes.list(
      {
        pageToken,
        pageSize: 1000,
        spaces: "drive",
        includeRemoved: true,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(parents))",
      },
      { timeout: METADATA_TIMEOUT_MS },
    );
    for (const change of data.changes ?? []) changes.push({ fileId: change.fileId ?? null, parents: change.file?.parents ?? [] });
    if (data.newStartPageToken) return { changes, nextStartPageToken: data.newStartPageToken };
    if (!data.nextPageToken) throw new Error("Google Drive returned an incomplete change list");
    pageToken = data.nextPageToken;
  }
}
