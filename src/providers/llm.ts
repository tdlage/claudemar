import { config } from "../config.js";

// Cada perfil parametriza por completo o proxy/gateway usado nas execuções do Agent
// SDK. baseUrl vazio = Anthropic nativo (mantém a subscription do Claude). Com baseUrl
// preenchido, as requisições são roteadas para o gateway (Bifrost) ou para qualquer
// endpoint compatível com a API da Anthropic, escolhendo o provedor pelo nome do modelo
// (provider/model, ex.: "openai/gpt-5.5", "zai/glm-5.2", "sakana/fugu-ultra").
export interface LlmProfile {
  id: string;
  label: string;
  baseUrl: string;
  tokenEnv: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  timeoutMs: string;
  autoCompactWindow: string;
  extraEnv: string;
}

export const GATEWAY_TOKEN_ENV = "BIFROST_VIRTUAL_KEY";
const GATEWAY_TIMEOUT_MS = "3000000";

const KIMI_BASE_URL = "https://api.kimi.com/coding";
const KIMI_MODEL = "k3[1m]";

// Endpoint usado pela primeira versão do perfil kimi. Instalações que já semearam esse
// perfil têm o valor antigo persistido em settings.json; a chave do Kimi Code (gerada em
// kimi.com/code) não autentica na Moonshot, então migramos o default intocado.
const KIMI_LEGACY_BASE_URL = "https://api.moonshot.ai/anthropic";

// Token enviado ao gateway quando nenhuma virtual key está configurada. O Bifrost sem
// governança ignora a credencial do cliente e usa as chaves dos upstreams; o placeholder
// evita vazar o token da subscription do Claude para o gateway.
const GATEWAY_PLACEHOLDER_TOKEN = "bifrost";

export function defaultLlmProfiles(): LlmProfile[] {
  const baseUrl = config.gatewayUrl;
  return [
    {
      id: "anthropic",
      label: "Anthropic (Claude)",
      baseUrl: "",
      tokenEnv: GATEWAY_TOKEN_ENV,
      opusModel: "",
      sonnetModel: "",
      haikuModel: "",
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "",
      extraEnv: "",
    },
    {
      id: "kimi",
      label: "Kimi (K3)",
      baseUrl: KIMI_BASE_URL,
      tokenEnv: "KIMI_API_KEY",
      opusModel: KIMI_MODEL,
      sonnetModel: KIMI_MODEL,
      haikuModel: KIMI_MODEL,
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "1048576",
      extraEnv: `CLAUDE_CODE_SUBAGENT_MODEL=${KIMI_MODEL}\nENABLE_TOOL_SEARCH=false`,
    },
    {
      id: "zai",
      label: "z.ai (GLM)",
      baseUrl,
      tokenEnv: GATEWAY_TOKEN_ENV,
      opusModel: "zai/glm-5.2",
      sonnetModel: "zai/glm-5.2",
      haikuModel: "zai/glm-4.7-flash",
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "1000000",
      extraEnv: "",
    },
    {
      id: "openai",
      label: "OpenAI (GPT)",
      baseUrl,
      tokenEnv: GATEWAY_TOKEN_ENV,
      opusModel: "openai/gpt-5.5",
      sonnetModel: "openai/gpt-5.4-mini",
      haikuModel: "openai/gpt-5.4-nano",
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "",
      extraEnv: "",
    },
    {
      id: "sakana",
      label: "Sakana (Fugu)",
      baseUrl,
      tokenEnv: GATEWAY_TOKEN_ENV,
      opusModel: "sakana/fugu-ultra",
      sonnetModel: "sakana/fugu",
      haikuModel: "sakana/fugu",
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "",
      extraEnv: "",
    },
  ];
}

export const DEFAULT_ACTIVE_PROFILE_ID = "anthropic";

export function sanitizeProfile(raw: unknown, fallbackId: string): LlmProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const id = str(r.id) || fallbackId;
  const label = str(r.label) || id;
  if (!id) return null;
  return {
    id,
    label,
    baseUrl: str(r.baseUrl),
    tokenEnv: str(r.tokenEnv),
    opusModel: str(r.opusModel),
    sonnetModel: str(r.sonnetModel),
    haikuModel: str(r.haikuModel),
    timeoutMs: str(r.timeoutMs),
    autoCompactWindow: str(r.autoCompactWindow),
    extraEnv: str(r.extraEnv),
  };
}

const EXTRA_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseExtraEnv(extraEnv: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const rawLine of extraEnv.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!EXTRA_ENV_KEY_PATTERN.test(key)) continue;
    entries.push([key, line.slice(eq + 1).trim()]);
  }
  return entries;
}

// Corrige perfis default cujos valores mudaram após já terem sido semeados. Só reescreve o
// perfil kimi quando ele ainda está no endpoint legado da Moonshot (default intocado),
// preservando qualquer customização feita pelo usuário.
export function migrateLegacyProfiles(profiles: LlmProfile[]): { profiles: LlmProfile[]; changed: boolean } {
  const kimiDefault = defaultLlmProfiles().find((p) => p.id === "kimi");
  if (!kimiDefault) return { profiles, changed: false };
  let changed = false;
  const migrated = profiles.map((p) => {
    if (p.id === "kimi" && p.baseUrl.trim() === KIMI_LEGACY_BASE_URL) {
      changed = true;
      return { ...kimiDefault, label: p.label || kimiDefault.label };
    }
    return p;
  });
  return { profiles: migrated, changed };
}

export interface SeedResult {
  profiles: LlmProfile[];
  seededIds: string[];
  changed: boolean;
}

// Acrescenta uma única vez os perfis padrão que ainda não foram semeados nesta
// instalação: seededIds registra os defaults já apresentados ao usuário, então um
// perfil padrão apagado por ele não é ressuscitado em cargas futuras.
export function seedMissingDefaultProfiles(profiles: LlmProfile[], seededIds: string[]): SeedResult {
  const merged = profiles.map((p) => ({ ...p }));
  const presentIds = new Set(merged.map((p) => p.id));
  const seeded = new Set(seededIds);
  let changed = false;
  for (const profile of defaultLlmProfiles()) {
    if (seeded.has(profile.id)) continue;
    if (!presentIds.has(profile.id)) {
      merged.push(profile);
      presentIds.add(profile.id);
    }
    seeded.add(profile.id);
    changed = true;
  }
  return { profiles: merged, seededIds: [...seeded], changed };
}

// Aplica o perfil sobre uma cópia do ambiente do processo. Sem baseUrl mantém o
// comportamento nativo (subscription do Claude). Com baseUrl, aponta o Agent SDK para o
// gateway e fixa os modelos por alias (opus/sonnet/haiku → provider/model). O extraEnv
// vale para qualquer perfil e é aplicado por último, podendo sobrescrever as demais vars.
export function applyProfile(baseEnv: NodeJS.ProcessEnv, profile: LlmProfile): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const baseUrl = profile.baseUrl.trim();

  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    const token = profile.tokenEnv ? (process.env[profile.tokenEnv] ?? "").trim() : "";
    env.ANTHROPIC_AUTH_TOKEN = token || GATEWAY_PLACEHOLDER_TOKEN;
    delete env.ANTHROPIC_API_KEY;

    if (profile.timeoutMs.trim()) env.API_TIMEOUT_MS = profile.timeoutMs.trim();

    const opus = profile.opusModel.trim();
    const sonnet = profile.sonnetModel.trim();
    const haiku = profile.haikuModel.trim();
    if (opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;

    const window = profile.autoCompactWindow.trim();
    if (window) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = window;
  }

  for (const [key, value] of parseExtraEnv(profile.extraEnv)) env[key] = value;

  return env;
}
