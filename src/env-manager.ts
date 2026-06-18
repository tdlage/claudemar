import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const ENV_PATH = resolve(config.installDir, ".env");

export interface ManagedEnvKey {
  key: string;
  label: string;
  group: string;
  help: string;
  required: boolean;
}

export const MANAGED_ENV_KEYS: ManagedEnvKey[] = [
  { key: "VOYAGE_API_KEY", label: "Voyage API Key", group: "Memória de longo prazo", help: "Embeddings (voyage-4-large) e rerank (rerank-2.5). Necessária para a memória.", required: false },
  { key: "QDRANT_URL", label: "Qdrant URL", group: "Memória de longo prazo", help: "Endpoint do cluster Qdrant (ex.: https://xxxx.cloud.qdrant.io).", required: false },
  { key: "QDRANT_API_KEY", label: "Qdrant API Key", group: "Memória de longo prazo", help: "Chave de acesso do Qdrant Cloud.", required: false },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", group: "Transcrição de voz", help: "Usada pelo Whisper para transcrever mensagens de voz.", required: false },
];

export interface EnvKeyStatus extends ManagedEnvKey {
  present: boolean;
}

export function getEnvStatus(): EnvKeyStatus[] {
  return MANAGED_ENV_KEYS.map((k) => ({ ...k, present: Boolean(process.env[k.key]) }));
}

function escapeEnvValue(value: string): string {
  if (/[\s"'#=]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function matchesKey(line: string, key: string): boolean {
  return line.replace(/^\s*export\s+/, "").startsWith(`${key}=`);
}

export function updateEnv(values: Record<string, string>): string[] {
  const allowed = new Set(MANAGED_ENV_KEYS.map((k) => k.key));
  const updated: string[] = [];

  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8").split("\n") : [];

  for (const [key, raw] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    const value = String(raw ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim();
    if (!value) continue;

    const line = `${key}=${escapeEnvValue(value)}`;
    const idx = lines.findIndex((l) => matchesKey(l, key));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);

    process.env[key] = value;
    updated.push(key);
  }

  if (updated.length === 0) return [];

  let content = lines.join("\n");
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(ENV_PATH, content, { encoding: "utf-8", mode: 0o600 });
  chmodSync(ENV_PATH, 0o600);

  return updated;
}
