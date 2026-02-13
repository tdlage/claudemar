import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

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

function maskValue(value: string): string {
  if (value.length < 10) return "*".repeat(value.length);
  return value.slice(0, 4) + "************" + value.slice(-4);
}

function secretsPath(agentName: string): string {
  return resolve(config.agentsPath, agentName, "secrets.json");
}

function loadSecrets(agentName: string): SecretEntry[] {
  try {
    const path = secretsPath(agentName);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    // corrupted file
  }
  return [];
}

function persistSecrets(agentName: string, secrets: SecretEntry[]): void {
  const path = secretsPath(agentName);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(secrets, null, 2), "utf-8");
  renameSync(tmp, path);
}

class SecretsManager {
  private cache = new Map<string, SecretEntry[]>();
  private dirty = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private getSecrets(agentName: string): SecretEntry[] {
    let secrets = this.cache.get(agentName);
    if (!secrets) {
      secrets = loadSecrets(agentName);
      this.cache.set(agentName, secrets);
    }
    return secrets;
  }

  private markDirty(agentName: string): void {
    this.dirty.add(agentName);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistAll(), 1000);
  }

  private persistAll(): void {
    for (const agentName of this.dirty) {
      const secrets = this.cache.get(agentName);
      if (secrets) persistSecrets(agentName, secrets);
    }
    this.dirty.clear();
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistAll();
  }

  getMaskedSecrets(agentName: string): MaskedSecret[] {
    return this.getSecrets(agentName).map((s) => ({
      id: s.id,
      name: s.name,
      maskedValue: maskValue(s.value),
      description: s.description,
    }));
  }

  getSecretValues(agentName: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const s of this.getSecrets(agentName)) {
      result[s.name] = s.value;
    }
    return result;
  }

  createSecret(agentName: string, name: string, value: string, description: string): MaskedSecret {
    const secrets = this.getSecrets(agentName);
    const entry: SecretEntry = { id: randomUUID(), name, value, description };
    secrets.push(entry);
    this.markDirty(agentName);
    return { id: entry.id, name: entry.name, maskedValue: maskValue(entry.value), description: entry.description };
  }

  updateSecret(agentName: string, id: string, fields: { name?: string; value?: string; description?: string }): MaskedSecret | null {
    const secrets = this.getSecrets(agentName);
    const entry = secrets.find((s) => s.id === id);
    if (!entry) return null;

    if (fields.name !== undefined) entry.name = fields.name;
    if (fields.value !== undefined && fields.value !== "") entry.value = fields.value;
    if (fields.description !== undefined) entry.description = fields.description;

    this.markDirty(agentName);
    return { id: entry.id, name: entry.name, maskedValue: maskValue(entry.value), description: entry.description };
  }

  deleteSecret(agentName: string, id: string): boolean {
    const secrets = this.getSecrets(agentName);
    const idx = secrets.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    secrets.splice(idx, 1);
    this.markDirty(agentName);
    return true;
  }
}

export const secretsManager = new SecretsManager();
