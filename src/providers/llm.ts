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
}

const GATEWAY_TOKEN_ENV = "BIFROST_VIRTUAL_KEY";
const GATEWAY_TIMEOUT_MS = "3000000";

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
      baseUrl,
      tokenEnv: GATEWAY_TOKEN_ENV,
      opusModel: "anthropic/claude-opus-4-8",
      sonnetModel: "anthropic/claude-sonnet-4-6",
      haikuModel: "anthropic/claude-haiku-4-5-20251001",
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "",
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
  };
}

// Aplica o perfil sobre uma cópia do ambiente do processo. Sem baseUrl mantém o
// comportamento nativo (subscription do Claude). Com baseUrl, aponta o Agent SDK para o
// gateway e fixa os modelos por alias (opus/sonnet/haiku → provider/model).
export function applyProfile(baseEnv: NodeJS.ProcessEnv, profile: LlmProfile): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const baseUrl = profile.baseUrl.trim();
  if (!baseUrl) return env;

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

  return env;
}
