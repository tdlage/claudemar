import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.js";
import { getAgentPaths } from "../agents/manager.js";
import { driveStore, type DriveAccount, type DriveFolderLink } from "./store.js";
import { authorizedClient, isReauthError } from "./oauth.js";
import {
  changeAffects,
  downloadFile,
  driveClient,
  driveWriter,
  driveErrorInfo,
  fileErrorMessage,
  getFolder,
  getStartPageToken,
  isFileLevelError,
  listChanges,
  listFolderTree,
} from "./drive-api.js";
import {
  applyMirror,
  FatalSyncError,
  MirrorAbortedError,
  planMirror,
  readManifest,
  sameLocalTree,
  scanLocalTree,
  uniqueName,
  writeManifest,
  type LocalTree,
} from "./mirror.js";
import { detectLocalChanges, hasLocalChanges, isMassDeletion, pushLocalChanges, salvageAfterSwap } from "./two-way.js";
import { DRIVE_INPUT_DIR, excludeFromAgentGit, manifestPath } from "./paths.js";

const MB = 1024 * 1024;
const TICK_MS = 60_000;
const FIRST_TICK_MS = 15_000;
const DOWNLOAD_CONCURRENCY = 4;
const MAX_PARALLEL_SYNCS = 3;
const FULL_RESYNC_MS = 6 * 60 * 60_000;
const SETTLE_MS = 10_000;
const LOCAL_RETRY_MS = 30_000;
const FAILURE_RETRY_MS = 5 * 60_000;
const UPLOAD_NOTE_TTL_MS = 7 * 24 * 60 * 60_000;
const NETWORK_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

export const REAUTH_MESSAGE = "Google authorization expired or was revoked. The owner must reconnect this Google account.";

const limits = {
  maxFiles: config.googleDriveMaxFiles,
  maxFileBytes: config.googleDriveMaxFileMb * MB,
  maxFolderBytes: config.googleDriveMaxFolderMb * MB,
};

interface LinkState {
  index: Set<string> | null;
  dirty: boolean;
  localDirty: boolean;
  failed: boolean;
  lastAttempt: number;
  lastFullSync: number;
}

interface AccountState {
  pageToken: string | null;
  lastPoll: number;
}

export interface SyncOptions {
  force?: boolean;
  flush?: boolean;
}

interface SyncResult {
  index: Set<string> | null;
  localPending: boolean;
}

class LocalChangesDuringSyncError extends Error {}

function describeFailure(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return `Could not reach Google Drive (${code}). It will retry on the next sync.`;
  const { status, message } = driveErrorInfo(err);
  if (status === 429 || (status !== null && status >= 500)) return `Google Drive is temporarily unavailable (${status}). It will retry on the next sync.`;
  return message;
}

function mirrorLocation(link: DriveFolderLink) {
  const paths = getAgentPaths(link.agentName);
  if (!paths) return null;
  const workDir = resolve(paths.input, DRIVE_INPUT_DIR);
  return {
    paths,
    workDir,
    root: resolve(workDir, link.localName),
    unsyncedDir: resolve(paths.output, "google-drive-unsynced", link.localName),
    unsyncedLabel: `output/google-drive-unsynced/${link.localName}`,
  };
}

async function setAsideLostState(root: string, unsyncedParent: string, localName: string): Promise<string> {
  await mkdir(unsyncedParent, { recursive: true });
  const name = uniqueName(`${localName} (recovered ${new Date().toISOString().slice(0, 10)})`, new Set(await readdir(unsyncedParent).catch(() => [])));
  await rename(root, resolve(unsyncedParent, name));
  return name;
}

export async function hasPendingLocalChanges(link: DriveFolderLink): Promise<boolean> {
  const location = mirrorLocation(link);
  if (!location || link.access !== "write") return false;
  const previous = await readManifest(manifestPath(link.id));
  if (!previous.baseline) return false;
  const local = await scanLocalTree(location.root);
  return local !== null && hasLocalChanges(detectLocalChanges(previous, local, Date.now()));
}

async function runSync(link: DriveFolderLink, signal: AbortSignal, options: SyncOptions): Promise<SyncResult> {
  const idle: SyncResult = { index: null, localPending: false };
  const account = driveStore.getAccount(link.accountId);
  const location = mirrorLocation(link);
  if (!account || !location || !existsSync(location.paths.root)) return idle;
  if (account.reauthRequired) {
    await driveStore.recordSync(link.id, { status: "error", message: REAUTH_MESSAGE });
    return idle;
  }

  const { paths, workDir, root, unsyncedDir, unsyncedLabel } = location;
  const writable = link.access === "write";
  const drive = driveClient(authorizedClient(account));
  try {
    const folder = await getFolder(drive, link.folderId, signal);
    if (!folder || folder.trashed) {
      const message = folder
        ? "The folder is in the Google Drive trash."
        : `The folder was deleted or is no longer shared with ${account.email}.`;
      await driveStore.recordSync(link.id, { status: "error", message });
      return idle;
    }
    if (writable && !folder.canAddChildren) {
      await driveStore.recordSync(link.id, { status: "error", message: `${account.email} can no longer edit this folder in Google Drive. Local changes are kept until write access returns or the folder is switched to read-only.` });
      return idle;
    }

    const tree = await listFolderTree(drive, { id: folder.id, driveId: folder.driveId }, { maxFiles: limits.maxFiles, signal });
    const manifestFile = manifestPath(link.id);
    const previous = await readManifest(manifestFile);
    await mkdir(workDir, { recursive: true });
    await excludeFromAgentGit(paths.root);

    const now = Date.now();
    const notes = previous.skipped.filter((entry) => entry.cause === "upload" && entry.notedAt && now - Date.parse(entry.notedAt) < UPLOAD_NOTE_TTL_MS);
    const messages: string[] = [];
    if (tree.truncated) messages.push(`Only the first ${limits.maxFiles} files are synced (GOOGLE_DRIVE_MAX_FILES).`);
    let snapshot: LocalTree | null = null;
    let rescued = false;

    if (writable) {
      const local = await scanLocalTree(root);
      if (local && previous.baseline) {
        if (!previous.folders?.length) previous.folders = planMirror(folder.id, tree.folders, tree.files).folders;
        const changes = detectLocalChanges(previous, local, now - (options.flush ? 0 : SETTLE_MS));
        if (changes.unsettled.length > 0) return { index: null, localPending: true };
        if (isMassDeletion(changes, previous)) {
          messages.push(`The agent deleted ${changes.deleted.length} of ${previous.files.length} files at once. To protect the folder, those deletions were not applied to Google Drive and the files were restored.`);
          changes.deleted = [];
          changes.deletedDirectories = [];
        }
        if (hasLocalChanges(changes)) {
          try {
            const context = { root, rootFolderId: folder.id, tree, manifest: previous, writer: driveWriter(drive, signal), unsyncedDir, unsyncedLabel, now: new Date() };
            notes.push(...(await pushLocalChanges(context, changes)));
          } finally {
            await writeManifest(manifestFile, { ...previous, skipped: [...previous.skipped.filter((entry) => entry.cause !== "upload"), ...notes], signature: null, baseline: true });
          }
        }
        snapshot = await scanLocalTree(root);
      } else if (local) {
        const recovered = await setAsideLostState(root, resolve(paths.output, "google-drive-unsynced"), link.localName);
        messages.push(`The sync state was missing, so the existing local copy was moved to output/google-drive-unsynced/${recovered} before downloading the folder again.`);
      }
    }

    const plan = planMirror(folder.id, tree.folders, tree.files, tree.skipped);
    const result = await applyMirror({
      root,
      workDir,
      key: link.id,
      plan,
      previous,
      concurrency: DOWNLOAD_CONCURRENCY,
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxFolderBytes,
      retrySkipped: options.force === true,
      signal,
      canCommit: () => driveStore.getFolder(link.id) !== undefined,
      fileMode: (entry) => (writable && !entry.readOnly ? 0o644 : 0o444),
      beforeCommit: writable
        ? async () => {
          if (!sameLocalTree(await scanLocalTree(root), snapshot)) throw new LocalChangesDuringSyncError("Local files changed during the sync");
        }
        : undefined,
      salvage: writable && snapshot
        ? async (trashDir) => {
          rescued = (await salvageAfterSwap(trashDir, snapshot!, root, unsyncedDir)).length > 0;
        }
        : undefined,
      download: async (file, destination) => {
        try {
          await downloadFile(drive, file, destination, { maxBytes: limits.maxFileBytes, signal });
        } catch (err) {
          if (isFileLevelError(err)) throw new Error(fileErrorMessage(err));
          throw new FatalSyncError(describeFailure(err), { cause: err });
        }
      },
    });

    const skipped = [...plan.skipped, ...result.skipped, ...notes].sort((a, b) => a.path.localeCompare(b.path));
    await writeManifest(manifestFile, { files: result.files, skipped, folders: plan.folders, signature: result.signature, baseline: true });
    await driveStore.recordSync(link.id, {
      status: "ok",
      message: messages.length > 0 ? messages.join(" ") : null,
      folderName: folder.name,
      fileCount: result.files.length,
      skippedCount: skipped.length,
      totalBytes: result.totalBytes,
      syncedAt: new Date().toISOString(),
    });
    const index = new Set([
      folder.id,
      ...tree.folders.map((entry) => entry.id),
      ...tree.files.flatMap((entry) => [entry.id, entry.sourceId]),
      ...tree.skipped.map((entry) => entry.id),
    ]);
    return { index, localPending: rescued };
  } catch (err) {
    if (err instanceof LocalChangesDuringSyncError) return { index: null, localPending: true };
    if (signal.aborted || err instanceof MirrorAbortedError) return idle;
    const cause = err instanceof FatalSyncError && err.cause ? err.cause : err;
    if (isReauthError(cause)) {
      await driveStore.markReauthRequired(account.id);
      await driveStore.recordSync(link.id, { status: "error", message: REAUTH_MESSAGE });
      return idle;
    }
    const message = err instanceof FatalSyncError ? err.message : describeFailure(cause);
    console.error(`[google-drive] sync of ${link.agentName}/${link.localName} failed: ${message}`);
    await driveStore.recordSync(link.id, { status: "error", message });
    return { index: null, localPending: false };
  }
}

class DriveSyncEngine {
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private links = new Map<string, LinkState>();
  private accounts = new Map<string, AccountState>();
  private timers: NodeJS.Timeout[] = [];
  private ticking = false;

  isSyncing(linkId: string): boolean {
    return this.jobs.has(linkId);
  }

  private linkState(linkId: string): LinkState {
    let state = this.links.get(linkId);
    if (!state) {
      state = { index: null, dirty: true, localDirty: false, failed: false, lastAttempt: 0, lastFullSync: 0 };
      this.links.set(linkId, state);
    }
    return state;
  }

  sync(linkId: string, options: SyncOptions = {}): Promise<void> {
    const running = this.jobs.get(linkId);
    if (running) return running.done;
    const link = driveStore.getFolder(linkId);
    if (!link) return Promise.resolve();
    const state = this.linkState(linkId);
    const controller = new AbortController();
    state.lastAttempt = Date.now();
    state.dirty = false;
    state.localDirty = false;
    const done = runSync(link, controller.signal, options)
      .then((result) => {
        if (controller.signal.aborted) return;
        state.failed = result.index === null && !result.localPending;
        state.localDirty = result.localPending;
        if (result.index) {
          state.index = result.index;
          state.lastFullSync = Date.now();
        } else {
          state.dirty = true;
        }
      })
      .catch((err) => {
        state.dirty = true;
        state.failed = true;
        console.error(`[google-drive] sync of ${link.agentName}/${link.localName} crashed:`, err instanceof Error ? err.stack ?? err.message : String(err));
      })
      .finally(() => this.jobs.delete(linkId));
    this.jobs.set(linkId, { controller, done });
    return done;
  }

  async flush(linkId: string): Promise<void> {
    await this.jobs.get(linkId)?.done;
    await this.sync(linkId, { flush: true });
  }

  afterAgentRun(agentName: string): void {
    const writable = driveStore.foldersOf(agentName).filter((link) => link.access === "write");
    if (writable.length === 0) return;
    const timer = setTimeout(() => {
      for (const link of writable) {
        this.linkState(link.id).localDirty = true;
        if (!this.jobs.has(link.id) && driveStore.getFolder(link.id)) void this.sync(link.id);
      }
    }, SETTLE_MS + 2_000);
    timer.unref();
  }

  async cancel(linkId: string): Promise<void> {
    const running = this.jobs.get(linkId);
    this.links.delete(linkId);
    if (!running) return;
    running.controller.abort();
    await running.done;
  }

  forgetAccount(accountId: string): void {
    this.accounts.delete(accountId);
  }

  start(): void {
    if (this.timers.length > 0) return;
    this.timers.push(setTimeout(() => void this.tick(), FIRST_TICK_MS).unref());
    this.timers.push(setInterval(() => void this.tick(), TICK_MS).unref());
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    for (const job of this.jobs.values()) job.controller.abort();
  }

  private async pollAccount(account: DriveAccount, links: DriveFolderLink[]): Promise<void> {
    const state = this.accounts.get(account.id) ?? { pageToken: null, lastPoll: 0 };
    this.accounts.set(account.id, state);
    state.lastPoll = Date.now();
    const drive = driveClient(authorizedClient(account));
    try {
      if (!state.pageToken) {
        state.pageToken = await getStartPageToken(drive);
        for (const link of links) this.linkState(link.id).dirty = true;
        return;
      }
      const { changes, nextStartPageToken } = await listChanges(drive, state.pageToken);
      state.pageToken = nextStartPageToken;
      for (const link of links) {
        const linkState = this.linkState(link.id);
        const index = linkState.index;
        if (!index || changes.some((change) => changeAffects(index, change))) linkState.dirty = true;
      }
    } catch (err) {
      if (isReauthError(err)) {
        await driveStore.markReauthRequired(account.id);
        return;
      }
      const { status } = driveErrorInfo(err);
      if (status !== null && status >= 400 && status < 500 && status !== 429) {
        state.pageToken = null;
        for (const link of links) this.linkState(link.id).dirty = true;
      }
      console.error(`[google-drive] change check for ${account.email} failed: ${describeFailure(err)}`);
    }
  }

  private isDue(link: DriveFolderLink, intervalMs: number, now: number): boolean {
    if (this.jobs.has(link.id)) return false;
    if (driveStore.getAccount(link.accountId)?.reauthRequired !== false) return false;
    const state = this.linkState(link.id);
    const elapsed = now - state.lastAttempt;
    if (state.failed && elapsed < FAILURE_RETRY_MS) return false;
    if (state.localDirty && elapsed >= LOCAL_RETRY_MS) return true;
    if (intervalMs <= 0 || elapsed < intervalMs) return false;
    return state.dirty || !state.index || now - state.lastFullSync >= FULL_RESYNC_MS;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const intervalMs = config.googleDriveSyncIntervalMinutes * 60_000;
      const folders = driveStore.allFolders();
      const byAccount = new Map<string, DriveFolderLink[]>();
      for (const link of folders) byAccount.set(link.accountId, [...(byAccount.get(link.accountId) ?? []), link]);
      for (const accountId of this.accounts.keys()) {
        if (!byAccount.has(accountId)) this.accounts.delete(accountId);
      }
      if (intervalMs > 0) {
        for (const [accountId, links] of byAccount) {
          const account = driveStore.getAccount(accountId);
          if (!account || account.reauthRequired) continue;
          if (Date.now() - (this.accounts.get(accountId)?.lastPoll ?? 0) < intervalMs) continue;
          await this.pollAccount(account, links);
        }
      }
      for (const link of folders) {
        if (link.access !== "write" || this.jobs.has(link.id)) continue;
        const state = this.linkState(link.id);
        if (!state.localDirty && (await hasPendingLocalChanges(link).catch(() => false))) state.localDirty = true;
      }
      const now = Date.now();
      const due = folders
        .filter((link) => this.isDue(link, intervalMs, now))
        .sort((a, b) => this.linkState(a.id).lastAttempt - this.linkState(b.id).lastAttempt);
      for (const link of due) {
        if (this.timers.length === 0 || this.jobs.size >= MAX_PARALLEL_SYNCS) break;
        void this.sync(link.id);
      }
    } finally {
      this.ticking = false;
    }
  }
}

export const driveSync = new DriveSyncEngine();
