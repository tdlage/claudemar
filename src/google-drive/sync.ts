import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.js";
import { getAgentPaths } from "../agents/manager.js";
import { driveStore, type DriveAccount, type DriveFolderLink } from "./store.js";
import { authorizedClient, isReauthError } from "./oauth.js";
import {
  changeAffects,
  downloadFile,
  driveClient,
  driveErrorInfo,
  fileErrorMessage,
  getFolder,
  getStartPageToken,
  isFileLevelError,
  listChanges,
  listFolderTree,
} from "./drive-api.js";
import { applyMirror, FatalSyncError, MirrorAbortedError, planMirror, readManifest, writeManifest } from "./mirror.js";
import { DRIVE_INPUT_DIR, excludeFromAgentGit, manifestPath } from "./paths.js";

const MB = 1024 * 1024;
const TICK_MS = 60_000;
const FIRST_TICK_MS = 15_000;
const DOWNLOAD_CONCURRENCY = 4;
const MAX_PARALLEL_SYNCS = 3;
const FULL_RESYNC_MS = 6 * 60 * 60_000;
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
  lastAttempt: number;
  lastFullSync: number;
}

interface AccountState {
  pageToken: string | null;
  lastPoll: number;
}

function describeFailure(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return `Could not reach Google Drive (${code}). It will retry on the next sync.`;
  const { status, message } = driveErrorInfo(err);
  if (status === 429 || (status !== null && status >= 500)) return `Google Drive is temporarily unavailable (${status}). It will retry on the next sync.`;
  return message;
}

async function runSync(link: DriveFolderLink, signal: AbortSignal, force: boolean): Promise<Set<string> | null> {
  const account = driveStore.getAccount(link.accountId);
  const paths = getAgentPaths(link.agentName);
  if (!account || !paths || !existsSync(paths.root)) return null;
  if (account.reauthRequired) {
    await driveStore.recordSync(link.id, { status: "error", message: REAUTH_MESSAGE });
    return null;
  }

  const drive = driveClient(authorizedClient(account));
  const workDir = resolve(paths.input, DRIVE_INPUT_DIR);
  try {
    const folder = await getFolder(drive, link.folderId, signal);
    if (!folder || folder.trashed) {
      const message = folder
        ? "The folder is in the Google Drive trash."
        : `The folder was deleted or is no longer shared with ${account.email}.`;
      await driveStore.recordSync(link.id, { status: "error", message });
      return null;
    }

    const tree = await listFolderTree(drive, { id: folder.id, driveId: folder.driveId }, { maxFiles: limits.maxFiles, signal });
    const plan = planMirror(folder.id, tree.folders, tree.files, tree.skipped);
    const manifestFile = manifestPath(link.id);
    const previous = await readManifest(manifestFile);
    await mkdir(workDir, { recursive: true });
    await excludeFromAgentGit(paths.root);

    const result = await applyMirror({
      root: resolve(workDir, link.localName),
      workDir,
      key: link.id,
      plan,
      previous,
      concurrency: DOWNLOAD_CONCURRENCY,
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxFolderBytes,
      retrySkipped: force,
      signal,
      canCommit: () => driveStore.getFolder(link.id) !== undefined,
      download: async (file, destination) => {
        try {
          await downloadFile(drive, file, destination, { maxBytes: limits.maxFileBytes, signal });
        } catch (err) {
          if (isFileLevelError(err)) throw new Error(fileErrorMessage(err));
          throw new FatalSyncError(describeFailure(err), { cause: err });
        }
      },
    });

    const skipped = [...plan.skipped, ...result.skipped].sort((a, b) => a.path.localeCompare(b.path));
    await writeManifest(manifestFile, { files: result.files, skipped, signature: result.signature });
    await driveStore.recordSync(link.id, {
      status: "ok",
      message: tree.truncated ? `Only the first ${limits.maxFiles} files are synced (GOOGLE_DRIVE_MAX_FILES).` : null,
      folderName: folder.name,
      fileCount: result.files.length,
      skippedCount: skipped.length,
      totalBytes: result.totalBytes,
      syncedAt: new Date().toISOString(),
    });
    return new Set([
      folder.id,
      ...tree.folders.map((entry) => entry.id),
      ...tree.files.flatMap((entry) => [entry.id, entry.sourceId]),
      ...tree.skipped.map((entry) => entry.id),
    ]);
  } catch (err) {
    if (signal.aborted || err instanceof MirrorAbortedError) return null;
    const cause = err instanceof FatalSyncError && err.cause ? err.cause : err;
    if (isReauthError(cause)) {
      await driveStore.markReauthRequired(account.id);
      await driveStore.recordSync(link.id, { status: "error", message: REAUTH_MESSAGE });
      return null;
    }
    const message = err instanceof FatalSyncError ? err.message : describeFailure(cause);
    console.error(`[google-drive] sync of ${link.agentName}/${link.localName} failed: ${message}`);
    await driveStore.recordSync(link.id, { status: "error", message });
    return null;
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
      state = { index: null, dirty: true, lastAttempt: 0, lastFullSync: 0 };
      this.links.set(linkId, state);
    }
    return state;
  }

  sync(linkId: string, options: { force?: boolean } = {}): Promise<void> {
    const running = this.jobs.get(linkId);
    if (running) return running.done;
    const link = driveStore.getFolder(linkId);
    if (!link) return Promise.resolve();
    const state = this.linkState(linkId);
    const controller = new AbortController();
    state.lastAttempt = Date.now();
    state.dirty = false;
    const done = runSync(link, controller.signal, options.force === true)
      .then((index) => {
        if (index) {
          state.index = index;
          state.lastFullSync = Date.now();
        } else if (!controller.signal.aborted) {
          state.dirty = true;
        }
      })
      .catch((err) => {
        state.dirty = true;
        console.error(`[google-drive] sync of ${link.agentName}/${link.localName} crashed:`, err instanceof Error ? err.stack ?? err.message : String(err));
      })
      .finally(() => this.jobs.delete(linkId));
    this.jobs.set(linkId, { controller, done });
    return done;
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
    if (this.timers.length > 0 || config.googleDriveSyncIntervalMinutes <= 0) return;
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
    if (now - state.lastAttempt < intervalMs) return false;
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
      for (const [accountId, links] of byAccount) {
        const account = driveStore.getAccount(accountId);
        if (!account || account.reauthRequired) continue;
        if (Date.now() - (this.accounts.get(accountId)?.lastPoll ?? 0) < intervalMs) continue;
        await this.pollAccount(account, links);
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
