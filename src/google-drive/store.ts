import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { Credentials } from "google-auth-library";
import { execute, query, toMySQLDatetime } from "../database.js";

export const ADMIN_OWNER_ID = "admin";

const MAX_FOLDER_NAME_LENGTH = 1024;
const MAX_MESSAGE_LENGTH = 2000;

export interface DriveAccount {
  id: string;
  ownerId: string;
  email: string;
  displayName: string;
  credentials: Credentials;
  reauthRequired: boolean;
  createdAt: string;
}

export type DriveFolderStatus = "pending" | "ok" | "error";

export interface DriveFolderLink {
  id: string;
  agentName: string;
  accountId: string;
  folderId: string;
  folderName: string;
  driveId: string | null;
  localName: string;
  status: DriveFolderStatus;
  message: string | null;
  fileCount: number;
  skippedCount: number;
  totalBytes: number;
  lastSyncedAt: string | null;
  createdAt: string;
}

export type SyncOutcome =
  | { status: "ok"; message: string | null; folderName: string; fileCount: number; skippedCount: number; totalBytes: number; syncedAt: string }
  | { status: "error"; message: string };

interface AccountRow extends RowDataPacket {
  id: string;
  owner_id: string;
  email: string;
  display_name: string;
  credentials: string;
  reauth_required: number;
  created_at: Date | string;
}

interface FolderRow extends RowDataPacket {
  id: string;
  agent_name: string;
  account_id: string;
  folder_id: string;
  folder_name: string;
  drive_id: string | null;
  local_name: string;
  status: string;
  message: string | null;
  file_count: number;
  skipped_count: number;
  total_bytes: number | string;
  last_synced_at: Date | string | null;
  created_at: Date | string;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseCredentials(raw: string): Credentials {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Credentials) : {};
  } catch {
    return {};
  }
}

function mergeCredentials(current: Credentials, fresh: Credentials): Credentials {
  return { ...current, ...fresh, refresh_token: fresh.refresh_token || current.refresh_token };
}

function toAccount(row: AccountRow): DriveAccount {
  return {
    id: row.id,
    ownerId: row.owner_id,
    email: row.email,
    displayName: row.display_name,
    credentials: parseCredentials(row.credentials),
    reauthRequired: Boolean(row.reauth_required),
    createdAt: isoDate(row.created_at),
  };
}

function toFolder(row: FolderRow): DriveFolderLink {
  const status: DriveFolderStatus = row.status === "ok" || row.status === "error" ? row.status : "pending";
  return {
    id: row.id,
    agentName: row.agent_name,
    accountId: row.account_id,
    folderId: row.folder_id,
    folderName: row.folder_name,
    driveId: row.drive_id,
    localName: row.local_name,
    status,
    message: row.message,
    fileCount: Number(row.file_count),
    skippedCount: Number(row.skipped_count),
    totalBytes: Number(row.total_bytes),
    lastSyncedAt: row.last_synced_at ? isoDate(row.last_synced_at) : null,
    createdAt: isoDate(row.created_at),
  };
}

function now(): string {
  return new Date().toISOString();
}

class DriveStore {
  private accounts = new Map<string, DriveAccount>();
  private folders = new Map<string, DriveFolderLink>();

  async initialize(): Promise<void> {
    const accountRows = await query<AccountRow[]>(
      "SELECT id, owner_id, email, display_name, credentials, reauth_required, created_at FROM google_drive_accounts",
    );
    const folderRows = await query<FolderRow[]>(
      `SELECT id, agent_name, account_id, folder_id, folder_name, drive_id, local_name, status, message,
              file_count, skipped_count, total_bytes, last_synced_at, created_at
       FROM agent_drive_folders ORDER BY created_at`,
    );
    this.accounts = new Map(accountRows.map((row) => [row.id, toAccount(row)]));
    this.folders = new Map(folderRows.map((row) => [row.id, toFolder(row)]));
  }

  getAccount(id: string): DriveAccount | undefined {
    return this.accounts.get(id);
  }

  accountsOf(ownerId: string): DriveAccount[] {
    return [...this.accounts.values()]
      .filter((account) => account.ownerId === ownerId)
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  accountsWithEmail(email: string): DriveAccount[] {
    return [...this.accounts.values()].filter((account) => account.email === email);
  }

  async saveAccount(ownerId: string, email: string, displayName: string, credentials: Credentials): Promise<DriveAccount> {
    const timestamp = now();
    const existing = [...this.accounts.values()].find((account) => account.ownerId === ownerId && account.email === email);
    if (existing) {
      const merged = mergeCredentials(existing.credentials, credentials);
      await execute(
        "UPDATE google_drive_accounts SET display_name = ?, credentials = ?, reauth_required = 0, updated_at = ? WHERE id = ?",
        [displayName, JSON.stringify(merged), toMySQLDatetime(timestamp), existing.id],
      );
      Object.assign(existing, { displayName, credentials: merged, reauthRequired: false });
      return existing;
    }
    const account: DriveAccount = { id: randomUUID(), ownerId, email, displayName, credentials, reauthRequired: false, createdAt: timestamp };
    await execute(
      `INSERT INTO google_drive_accounts (id, owner_id, email, display_name, credentials, reauth_required, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [account.id, ownerId, email, displayName, JSON.stringify(credentials), toMySQLDatetime(timestamp), toMySQLDatetime(timestamp)],
    );
    this.accounts.set(account.id, account);
    return account;
  }

  async updateCredentials(id: string, fresh: Credentials): Promise<void> {
    const account = this.accounts.get(id);
    if (!account) return;
    account.credentials = mergeCredentials(account.credentials, fresh);
    account.reauthRequired = false;
    await execute(
      "UPDATE google_drive_accounts SET credentials = ?, reauth_required = 0, updated_at = ? WHERE id = ?",
      [JSON.stringify(account.credentials), toMySQLDatetime(now()), id],
    );
  }

  async markReauthRequired(id: string): Promise<void> {
    const account = this.accounts.get(id);
    if (!account || account.reauthRequired) return;
    account.reauthRequired = true;
    await execute("UPDATE google_drive_accounts SET reauth_required = 1, updated_at = ? WHERE id = ?", [toMySQLDatetime(now()), id]);
  }

  async deleteAccount(id: string): Promise<DriveFolderLink[]> {
    const removed = this.foldersOfAccount(id);
    await execute("DELETE FROM google_drive_accounts WHERE id = ?", [id]);
    this.accounts.delete(id);
    for (const folder of removed) this.folders.delete(folder.id);
    return removed;
  }

  getFolder(id: string): DriveFolderLink | undefined {
    return this.folders.get(id);
  }

  allFolders(): DriveFolderLink[] {
    return [...this.folders.values()];
  }

  foldersOf(agentName: string): DriveFolderLink[] {
    return this.allFolders().filter((folder) => folder.agentName === agentName);
  }

  foldersOfAccount(accountId: string): DriveFolderLink[] {
    return this.allFolders().filter((folder) => folder.accountId === accountId);
  }

  findFolder(agentName: string, folderId: string): DriveFolderLink | undefined {
    return this.allFolders().find((folder) => folder.agentName === agentName && folder.folderId === folderId);
  }

  async createFolder(input: Pick<DriveFolderLink, "agentName" | "accountId" | "folderId" | "folderName" | "driveId" | "localName">): Promise<DriveFolderLink> {
    const folder: DriveFolderLink = {
      ...input,
      id: randomUUID(),
      folderName: input.folderName.slice(0, MAX_FOLDER_NAME_LENGTH),
      status: "pending",
      message: null,
      fileCount: 0,
      skippedCount: 0,
      totalBytes: 0,
      lastSyncedAt: null,
      createdAt: now(),
    };
    await execute(
      `INSERT INTO agent_drive_folders (id, agent_name, account_id, folder_id, folder_name, drive_id, local_name, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [folder.id, folder.agentName, folder.accountId, folder.folderId, folder.folderName, folder.driveId, folder.localName, toMySQLDatetime(folder.createdAt)],
    );
    this.folders.set(folder.id, folder);
    return folder;
  }

  async recordSync(id: string, outcome: SyncOutcome): Promise<void> {
    const folder = this.folders.get(id);
    if (!folder) return;
    folder.status = outcome.status;
    folder.message = outcome.message ? outcome.message.slice(0, MAX_MESSAGE_LENGTH) : null;
    if (outcome.status === "ok") {
      Object.assign(folder, {
        folderName: outcome.folderName.slice(0, MAX_FOLDER_NAME_LENGTH),
        fileCount: outcome.fileCount,
        skippedCount: outcome.skippedCount,
        totalBytes: outcome.totalBytes,
        lastSyncedAt: outcome.syncedAt,
      });
    }
    await execute(
      `UPDATE agent_drive_folders
       SET folder_name = ?, status = ?, message = ?, file_count = ?, skipped_count = ?, total_bytes = ?, last_synced_at = ?
       WHERE id = ?`,
      [
        folder.folderName,
        folder.status,
        folder.message,
        folder.fileCount,
        folder.skippedCount,
        folder.totalBytes,
        folder.lastSyncedAt ? toMySQLDatetime(folder.lastSyncedAt) : null,
        id,
      ],
    );
  }

  async deleteFolder(id: string): Promise<void> {
    await execute("DELETE FROM agent_drive_folders WHERE id = ?", [id]);
    this.folders.delete(id);
  }
}

export const driveStore = new DriveStore();
