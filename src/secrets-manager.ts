import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
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

export interface SecretFileInfo {
  name: string;
  size: number;
  description: string;
}

interface FileDescriptions {
  [filename: string]: string;
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

  private filesDir(agentName: string): string {
    return resolve(config.agentsPath, agentName, "secrets", "files");
  }

  private fileDescriptionsPath(agentName: string): string {
    return resolve(config.agentsPath, agentName, "secrets", "file-descriptions.json");
  }

  private loadFileDescriptions(agentName: string): FileDescriptions {
    try {
      const path = this.fileDescriptionsPath(agentName);
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, "utf-8"));
      }
    } catch {
      // corrupted
    }
    return {};
  }

  private persistFileDescriptions(agentName: string, descriptions: FileDescriptions): void {
    const path = this.fileDescriptionsPath(agentName);
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(descriptions, null, 2), "utf-8");
    renameSync(tmp, path);
  }

  getSecretFiles(agentName: string): SecretFileInfo[] {
    const dir = this.filesDir(agentName);
    if (!existsSync(dir)) return [];
    const descriptions = this.loadFileDescriptions(agentName);
    return readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(dir, f));
        return { name: f, size: stat.size, description: descriptions[f] ?? "" };
      });
  }

  saveSecretFile(agentName: string, filename: string, data: Buffer): SecretFileInfo {
    const dir = this.filesDir(agentName);
    mkdirSync(dir, { recursive: true });
    const filePath = resolve(dir, filename);
    writeFileSync(filePath, data);
    const stat = statSync(filePath);
    const descriptions = this.loadFileDescriptions(agentName);
    return { name: filename, size: stat.size, description: descriptions[filename] ?? "" };
  }

  deleteSecretFile(agentName: string, filename: string): boolean {
    const filePath = resolve(this.filesDir(agentName), filename);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    const descriptions = this.loadFileDescriptions(agentName);
    if (descriptions[filename]) {
      delete descriptions[filename];
      this.persistFileDescriptions(agentName, descriptions);
    }
    return true;
  }

  updateSecretFileDescription(agentName: string, filename: string, description: string): boolean {
    const filePath = resolve(this.filesDir(agentName), filename);
    if (!existsSync(filePath)) return false;
    const dir = resolve(config.agentsPath, agentName, "secrets");
    mkdirSync(dir, { recursive: true });
    const descriptions = this.loadFileDescriptions(agentName);
    descriptions[filename] = description;
    this.persistFileDescriptions(agentName, descriptions);
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
