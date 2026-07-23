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

const GATEWAY_GROUP = "Gateway de LLM (Bifrost)";
const DIRECT_GROUP = "Provedores LLM (conexão direta)";

export const MANAGED_ENV_KEYS: ManagedEnvKey[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", group: GATEWAY_GROUP, help: "Usada pelo gateway para os modelos OpenAI (perfil openai) e pelo Whisper na transcrição de voz.", required: false },
  { key: "ZAI_API_KEY", label: "z.ai API Key", group: GATEWAY_GROUP, help: "Token da z.ai (GLM). Consumido pelo gateway no perfil z.ai.", required: false },
  { key: "SAKANA_API_KEY", label: "Sakana API Key", group: GATEWAY_GROUP, help: "Token da Sakana AI (Fugu). Consumido pelo gateway no perfil sakana.", required: false },
  { key: "KIMI_API_KEY", label: "Kimi API Key", group: DIRECT_GROUP, help: "Chave do Kimi Code (endpoint api.kimi.com/coding, compatível com a API da Anthropic) para o perfil kimi. Obtenha no console em https://www.kimi.com/code (Create API Key). Não confundir com a chave da plataforma Moonshot.", required: false },
  { key: "BIFROST_ANTHROPIC_API_KEY", label: "Anthropic API Key (gateway)", group: GATEWAY_GROUP, help: "Chave da Anthropic usada pelo gateway no perfil anthropic. Mantida separada de ANTHROPIC_API_KEY para não substituir a subscription do Claude.", required: false },
  { key: "BIFROST_VIRTUAL_KEY", label: "Bifrost Virtual Key", group: GATEWAY_GROUP, help: "Opcional. Virtual key enviada ao gateway (Authorization: Bearer) quando a governança do Bifrost está habilitada.", required: false },
  { key: "VOYAGE_API_KEY", label: "Voyage API Key", group: "Memória de longo prazo", help: "Embeddings (voyage-4-large) e rerank (rerank-2.5). Necessária para a memória.", required: false },
  { key: "QDRANT_URL", label: "Qdrant URL", group: "Memória de longo prazo", help: "Endpoint do cluster Qdrant (ex.: https://xxxx.cloud.qdrant.io).", required: false },
  { key: "QDRANT_API_KEY", label: "Qdrant API Key", group: "Memória de longo prazo", help: "Chave de acesso do Qdrant Cloud.", required: false },
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
