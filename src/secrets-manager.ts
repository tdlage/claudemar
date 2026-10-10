import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { query, execute } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";
import { listAgents } from "./agents/manager.js";
import { listProjects } from "./session.js";

export interface SecretEntry {
  id: string;
  name: string;
  value: string;
  description: string;
}

export interface MaskedSecret {
  id: string;
  name: string;
  maskedValue: string;
  description: string;
}

export interface SecretFileInfo {
  name: string;
  size: number;
  description: string;
}

interface SecretRow extends RowDataPacket {
  id: string;
  name: string;
  value: string;
  description: string;
}

interface FileDescRow extends RowDataPacket {
  filename: string;
  description: string;
}

interface SecretsScope {
  secretsTable: string;
  fileDescriptionsTable: string;
  ownerColumn: string;
  jsonPath: (owner: string) => string;
  filesDir: (owner: string) => string;
  listOwners: () => string[];
}

function maskValue(value: string): string {
  if (value.length < 10) return "*".repeat(value.length);
  return value.slice(0, 4) + "************" + value.slice(-4);
}

export class SecretsManager {
  private cache = new Map<string, SecretEntry[]>();

  constructor(private readonly scope: SecretsScope) {}

  private async getSecrets(owner: string): Promise<SecretEntry[]> {
    let secrets = this.cache.get(owner);
    if (!secrets) {
      const { secretsTable, ownerColumn } = this.scope;
      const rows = await query<SecretRow[]>(
        `SELECT id, name, value, description FROM ${secretsTable} WHERE ${ownerColumn} = ?`,
        [owner],
      );
      secrets = rows.map((r) => ({ id: r.id, name: r.name, value: r.value, description: r.description }));
      this.cache.set(owner, secrets);
    }
    return secrets;
  }

  async getMaskedSecrets(owner: string): Promise<MaskedSecret[]> {
    const secrets = await this.getSecrets(owner);
    return secrets.map((s) => ({
      id: s.id,
      name: s.name,
      maskedValue: maskValue(s.value),
      description: s.description,
    }));
  }

  async getSecret(owner: string, id: string): Promise<SecretEntry | null> {
    const secrets = await this.getSecrets(owner);
    return secrets.find((s) => s.id === id) ?? null;
  }

  async createSecret(owner: string, name: string, value: string, description: string): Promise<MaskedSecret> {
    const entry: SecretEntry = { id: randomUUID(), name, value, description };
    const { secretsTable, ownerColumn } = this.scope;
    await execute(
      `INSERT INTO ${secretsTable} (id, ${ownerColumn}, name, value, description) VALUES (?, ?, ?, ?, ?)`,
      [entry.id, owner, entry.name, entry.value, entry.description],
    );
    this.cache.delete(owner);
    await this.syncToFile(owner);
    return { id: entry.id, name: entry.name, maskedValue: maskValue(entry.value), description: entry.description };
  }

  async updateSecret(owner: string, id: string, fields: { name?: string; value?: string; description?: string }): Promise<MaskedSecret | null> {
    const secrets = await this.getSecrets(owner);
    const entry = secrets.find((s) => s.id === id);
    if (!entry) return null;

    if (fields.name !== undefined) entry.name = fields.name;
    if (fields.value !== undefined && fields.value !== "") entry.value = fields.value;
    if (fields.description !== undefined) entry.description = fields.description;

    const { secretsTable, ownerColumn } = this.scope;
    await execute(
      `UPDATE ${secretsTable} SET name = ?, value = ?, description = ? WHERE id = ? AND ${ownerColumn} = ?`,
      [entry.name, entry.value, entry.description, id, owner],
    );
    this.cache.delete(owner);
    await this.syncToFile(owner);
    return { id: entry.id, name: entry.name, maskedValue: maskValue(entry.value), description: entry.description };
  }

  async deleteSecret(owner: string, id: string): Promise<boolean> {
    const { secretsTable, ownerColumn } = this.scope;
    const result = await execute(`DELETE FROM ${secretsTable} WHERE id = ? AND ${ownerColumn} = ?`, [id, owner]);
    if (result.affectedRows > 0) {
      this.cache.delete(owner);
      await this.syncToFile(owner);
      return true;
    }
    return false;
  }

  private async loadFileDescriptions(owner: string): Promise<Record<string, string>> {
    const { fileDescriptionsTable, ownerColumn } = this.scope;
    const rows = await query<FileDescRow[]>(
      `SELECT filename, description FROM ${fileDescriptionsTable} WHERE ${ownerColumn} = ?`,
      [owner],
    );
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.filename] = r.description;
    }
    return result;
  }

  async getSecretFiles(owner: string): Promise<SecretFileInfo[]> {
    const dir = this.scope.filesDir(owner);
    if (!existsSync(dir)) return [];
    const descriptions = await this.loadFileDescriptions(owner);
    return readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(dir, f));
        return { name: f, size: stat.size, description: descriptions[f] ?? "" };
      });
  }

  async saveSecretFile(owner: string, filename: string, data: Buffer): Promise<SecretFileInfo> {
    const dir = this.scope.filesDir(owner);
    mkdirSync(dir, { recursive: true });
    const filePath = resolve(dir, filename);
    writeFileSync(filePath, data);
    const stat = statSync(filePath);
    const descriptions = await this.loadFileDescriptions(owner);
    await this.syncToFile(owner);
    return { name: filename, size: stat.size, description: descriptions[filename] ?? "" };
  }

  async deleteSecretFile(owner: string, filename: string): Promise<boolean> {
    const filePath = resolve(this.scope.filesDir(owner), filename);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    const { fileDescriptionsTable, ownerColumn } = this.scope;
    await execute(
      `DELETE FROM ${fileDescriptionsTable} WHERE ${ownerColumn} = ? AND filename = ?`,
      [owner, filename],
    );
    await this.syncToFile(owner);
    return true;
  }

  async updateSecretFileDescription(owner: string, filename: string, description: string): Promise<boolean> {
    const filePath = resolve(this.scope.filesDir(owner), filename);
    if (!existsSync(filePath)) return false;
    const { fileDescriptionsTable, ownerColumn } = this.scope;
    await execute(
      `INSERT INTO ${fileDescriptionsTable} (${ownerColumn}, filename, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [owner, filename, description],
    );
    return true;
  }

  getSecretFilePaths(owner: string): Record<string, string> {
    const dir = this.scope.filesDir(owner);
    if (!existsSync(dir)) return {};
    const result: Record<string, string> = {};
    for (const f of readdirSync(dir).filter((f) => !f.startsWith("."))) {
      result[f] = resolve(dir, f);
    }
    return result;
  }

  secretsJsonPath(owner: string): string {
    return this.scope.jsonPath(owner);
  }

  async syncToFile(owner: string): Promise<void> {
    const secrets = await this.getSecrets(owner);
    const filePaths = this.getSecretFilePaths(owner);
    const jsonPath = this.scope.jsonPath(owner);

    if (secrets.length === 0 && Object.keys(filePaths).length === 0) {
      if (existsSync(jsonPath)) unlinkSync(jsonPath);
      return;
    }

    const data = {
      secrets: secrets.map((s) => ({ name: s.name, value: s.value, description: s.description })),
      files: filePaths,
    };

    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  }

  async syncAllToFiles(): Promise<void> {
    for (const owner of this.scope.listOwners()) {
      await this.syncToFile(owner);
    }
  }

  async purge(owner: string): Promise<void> {
    const { secretsTable, fileDescriptionsTable, ownerColumn } = this.scope;
    await execute(`DELETE FROM ${secretsTable} WHERE ${ownerColumn} = ?`, [owner]);
    await execute(`DELETE FROM ${fileDescriptionsTable} WHERE ${ownerColumn} = ?`, [owner]);
    this.cache.delete(owner);
  }
}

export const PROJECT_SECRETS_ROOT = resolve(config.dataPath, "project-secrets");

export function projectSecretsDir(projectName: string): string {
  const dir = resolve(PROJECT_SECRETS_ROOT, projectName);
  if (!dir.startsWith(PROJECT_SECRETS_ROOT + sep)) throw new Error(`Invalid project name: ${projectName}`);
  return dir;
}

export const agentSecretsManager = new SecretsManager({
  secretsTable: "agent_secrets",
  fileDescriptionsTable: "agent_secret_file_descriptions",
  ownerColumn: "agent_name",
  jsonPath: (agent) => resolve(config.agentsPath, agent, "secrets.json"),
  filesDir: (agent) => resolve(config.agentsPath, agent, "secrets", "files"),
  listOwners: listAgents,
});

export const projectSecretsManager = new SecretsManager({
  secretsTable: "project_secrets",
  fileDescriptionsTable: "project_secret_file_descriptions",
  ownerColumn: "project_name",
  jsonPath: (project) => resolve(projectSecretsDir(project), "secrets.json"),
  filesDir: (project) => resolve(projectSecretsDir(project), "files"),
  listOwners: listProjects,
});

export async function purgeProjectSecrets(projectName: string): Promise<void> {
  await projectSecretsManager.purge(projectName);
  await rm(projectSecretsDir(projectName), { recursive: true, force: true });
}
