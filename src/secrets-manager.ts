import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export interface SecretEntry {
  id: string;
  agentName: string;
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

const SECRETS_PATH = resolve(config.basePath, "secrets.json");

function maskValue(value: string): string {
  if (value.length < 10) return "*".repeat(value.length);
  return value.slice(0, 4) + "************" + value.slice(-4);
}

class SecretsManager {
  private secrets: SecretEntry[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(SECRETS_PATH)) {
        const raw = readFileSync(SECRETS_PATH, "utf-8");
        this.secrets = JSON.parse(raw);
      }
    } catch {
      this.secrets = [];
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow(), 1000);
  }

  private persistNow(): void {
    const tmp = SECRETS_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.secrets, null, 2), "utf-8");
    renameSync(tmp, SECRETS_PATH);
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistNow();
  }

  getMaskedSecrets(agentName: string): MaskedSecret[] {
    return this.secrets
      .filter((s) => s.agentName === agentName)
      .map((s) => ({
        id: s.id,
        name: s.name,
        maskedValue: maskValue(s.value),
        description: s.description,
      }));
  }

  getSecretValues(agentName: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const s of this.secrets) {
      if (s.agentName === agentName) {
        result[s.name] = s.value;
      }
    }
    return result;
  }

  createSecret(agentName: string, name: string, value: string, description: string): MaskedSecret {
    const entry: SecretEntry = {
      id: randomUUID(),
      agentName,
      name,
      value,
      description,
    };
    this.secrets.push(entry);
    this.schedulePersist();
    return {
      id: entry.id,
      name: entry.name,
      maskedValue: maskValue(entry.value),
      description: entry.description,
    };
  }

  updateSecret(id: string, fields: { name?: string; value?: string; description?: string }): MaskedSecret | null {
    const entry = this.secrets.find((s) => s.id === id);
    if (!entry) return null;

    if (fields.name !== undefined) entry.name = fields.name;
    if (fields.value !== undefined && fields.value !== "") entry.value = fields.value;
    if (fields.description !== undefined) entry.description = fields.description;

    this.schedulePersist();
    return {
      id: entry.id,
      name: entry.name,
      maskedValue: maskValue(entry.value),
      description: entry.description,
    };
  }

  deleteSecret(id: string): boolean {
    const idx = this.secrets.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.secrets.splice(idx, 1);
    this.schedulePersist();
    return true;
  }

  getSecretAgentName(id: string): string | null {
    return this.secrets.find((s) => s.id === id)?.agentName ?? null;
  }
}

export const secretsManager = new SecretsManager();
