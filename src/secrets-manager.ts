import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { query, execute } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

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
  agent_name: string;
  name: string;
  value: string;
  description: string;
}

interface FileDescRow extends RowDataPacket {
  agent_name: string;
  filename: string;
  description: string;
}

function maskValue(value: string): string {
  if (value.length < 10) return "*".repeat(value.length);
  return value.slice(0, 4) + "************" + value.slice(-4);
}

class SecretsManager {
  private cache = new Map<string, SecretEntry[]>();

  private async getSecrets(agentName: string): Promise<SecretEntry[]> {
    let secrets = this.cache.get(agentName);
    if (!secrets) {
      const rows = await query<SecretRow[]>(
        "SELECT id, name, value, description FROM agent_secrets WHERE agent_name = ?",
        [agentName],
      );
      secrets = rows.map((r) => ({ id: r.id, name: r.name, value: r.value, description: r.description }));
      this.cache.set(agentName, secrets);
    }
    return secrets;
  }

  async getMaskedSecrets(agentName: string): Promise<MaskedSecret[]> {
    const secrets = await this.getSecrets(agentName);
    return secrets.map((s) => ({
      id: s.id,
      name: s.name,
      maskedValue: maskValue(s.value),
      description: s.description,
    }));
  }

  async getSecretValues(agentName: string): Promise<Record<string, string>> {
    const secrets = await this.getSecrets(agentName);
    const result: Record<string, string> = {};
    for (const s of secrets) {
      result[s.name] = s.value;
    }
    return result;
  }

  async createSecret(agentName: string, name: string, value: string, description: string): Promise<MaskedSecret> {
    const entry: SecretEntry = { id: randomUUID(), name, value, description };
    await execute(
      "INSERT INTO agent_secrets (id, agent_name, name, value, description) VALUES (?, ?, ?, ?, ?)",
      [entry.id, agentName, entry.name, entry.value, entry.description],
    );
    this.cache.delete(agentName);
    return { id: entry.id, name: entry.name, maskedValue: maskValue(entry.value), description: entry.description };
  }

  async updateSecret(agentName: string, id: string, fields: { name?: string; value?: string; description?: string }): Promise<MaskedSecret | null> {
    const secrets = await this.getSecrets(agentName);
    const entry = secrets.find((s) => s.id === id);
    if (!entry) return null;

    if (fields.name !== undefined) entry.name = fields.name;
    if (fields.value !== undefined && fields.value !== "") entry.value = fields.value;
    if (fields.description !== undefined) entry.description = fields.description;

    await execute(
      "UPDATE agent_secrets SET name = ?, value = ?, description = ? WHERE id = ?",
      [entry.name, entry.value, entry.description, id],
    );
    this.cache.delete(agentName);
    return { id: entry.id, name: entry.name, maskedValue: maskValue(entry.value), description: entry.description };
  }

  async deleteSecret(agentName: string, id: string): Promise<boolean> {
    const result = await execute("DELETE FROM agent_secrets WHERE id = ? AND agent_name = ?", [id, agentName]);
    if (result.affectedRows > 0) {
      this.cache.delete(agentName);
      return true;
    }
    return false;
  }

  private filesDir(agentName: string): string {
    return resolve(config.agentsPath, agentName, "secrets", "files");
  }

  private async loadFileDescriptions(agentName: string): Promise<Record<string, string>> {
    const rows = await query<FileDescRow[]>(
      "SELECT filename, description FROM agent_secret_file_descriptions WHERE agent_name = ?",
      [agentName],
    );
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.filename] = r.description;
    }
    return result;
  }

  async getSecretFiles(agentName: string): Promise<SecretFileInfo[]> {
    const dir = this.filesDir(agentName);
    if (!existsSync(dir)) return [];
    const descriptions = await this.loadFileDescriptions(agentName);
    return readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(dir, f));
        return { name: f, size: stat.size, description: descriptions[f] ?? "" };
      });
  }

  async saveSecretFile(agentName: string, filename: string, data: Buffer): Promise<SecretFileInfo> {
    const dir = this.filesDir(agentName);
    mkdirSync(dir, { recursive: true });
    const filePath = resolve(dir, filename);
    writeFileSync(filePath, data);
    const stat = statSync(filePath);
    const descriptions = await this.loadFileDescriptions(agentName);
    return { name: filename, size: stat.size, description: descriptions[filename] ?? "" };
  }

  async deleteSecretFile(agentName: string, filename: string): Promise<boolean> {
    const filePath = resolve(this.filesDir(agentName), filename);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    await execute(
      "DELETE FROM agent_secret_file_descriptions WHERE agent_name = ? AND filename = ?",
      [agentName, filename],
    );
    return true;
  }

  async updateSecretFileDescription(agentName: string, filename: string, description: string): Promise<boolean> {
    const filePath = resolve(this.filesDir(agentName), filename);
    if (!existsSync(filePath)) return false;
    await execute(
      `INSERT INTO agent_secret_file_descriptions (agent_name, filename, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [agentName, filename, description],
    );
    return true;
  }

  getSecretFilePaths(agentName: string): Record<string, string> {
    const dir = this.filesDir(agentName);
    if (!existsSync(dir)) return {};
    const result: Record<string, string> = {};
    for (const f of readdirSync(dir).filter((f) => !f.startsWith("."))) {
      result[f] = resolve(dir, f);
    }
    return result;
  }
}

export const secretsManager = new SecretsManager();
