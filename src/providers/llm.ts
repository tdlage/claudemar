import { config } from "../config.js";

// Cada perfil parametriza por completo o proxy/gateway usado nas execuções do Agent
// SDK. baseUrl vazio = Anthropic nativo (mantém a subscription do Claude). Com baseUrl
// preenchido, as requisições são roteadas para o gateway (Bifrost) ou para qualquer
// endpoint compatível com a API da Anthropic, escolhendo o provedor pelo nome do modelo
// (provider/model, ex.: "openai/gpt-5.5", "sakana/fugu-ultra").
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
// A documentação do Kimi Code diz que `k3[1m]` é o seletor usado pelo Claude Code
// para forçar a janela de 1M tokens. Para chamadas diretas à API Anthropic-compatível
// (que é o que o Agent SDK faz), o model ID correto é o bare `k3`; `k3[1m]` é
// interpretado pelo upstream como um modelo de 256K e retorna 400 quando o request
// passa de 262144 tokens.
const KIMI_MODEL = "k3";

// Endpoint usado pela primeira versão do perfil kimi. Instalações que já semearam esse
// perfil têm o valor antigo persistido em settings.json; a chave do Kimi Code (gerada em
// kimi.com/code) não autentica na Moonshot, então migramos o default intocado.
const KIMI_LEGACY_BASE_URL = "https://api.moonshot.ai/anthropic";

// GLM Coding Plan: a quota da assinatura só vale no endpoint de coding Anthropic-compatible.
// Roteado pelo Bifrost (endpoint geral api/paas/v4) o upstream responde "Insufficient
// balance", então o perfil zai conecta direto, como o kimi. O sufixo `[1m]` que a z.ai
// documenta para o Claude Code retorna 400 em chamadas diretas à API — usar o nome bare.
const ZAI_BASE_URL = "https://api.z.ai/api/anthropic";
const ZAI_MODEL = "glm-5.3";
const ZAI_HAIKU_MODEL = "glm-5.3-flash";

// A quota do ChatGPT (Plus/Pro) não é acessível por API key: só o backend do Codex a
// aceita, com OAuth do ChatGPT e identidade de cliente oficial — fluxo que o Bifrost
// não faz (maximhq/bifrost#4459). O perfil aponta direto para o proxy local claude-codex
// (fcakyon/claude-code-with-codex), que traduz Messages→Responses e injeta o login do
// Codex CLI (~/.codex/auth.json). O proxy ignora o token de cliente nas rotas gpt-*.
// Janela gerida a 200K: o teto real do plano é 372K, mas o proxy compacta contra 200K.
const CODEX_PROXY_URL = "http://127.0.0.1:18765";
const CODEX_MODEL = "gpt-5.6-sol";
const CODEX_HAIKU_MODEL = "gpt-5.6-luna";

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
      baseUrl: ZAI_BASE_URL,
      tokenEnv: "ZAI_API_KEY",
      opusModel: ZAI_MODEL,
      sonnetModel: ZAI_MODEL,
      haikuModel: ZAI_HAIKU_MODEL,
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
      id: "codex",
      label: "OpenAI Codex (ChatGPT)",
      baseUrl: CODEX_PROXY_URL,
      tokenEnv: "",
      opusModel: CODEX_MODEL,
      sonnetModel: CODEX_MODEL,
      haikuModel: CODEX_HAIKU_MODEL,
      timeoutMs: GATEWAY_TIMEOUT_MS,
      autoCompactWindow: "200000",
      extraEnv: `CLAUDE_CODE_SUBAGENT_MODEL=${CODEX_HAIKU_MODEL}\nCLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
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

// Corrige perfis default cujos valores mudaram após já terem sido semeados. Só reescreve
// um perfil quando o baseUrl ainda é o legado (default intocado), preservando qualquer
// customização feita pelo usuário: kimi no endpoint antigo da Moonshot e zai ainda
// roteado pelo gateway (incompatível com a quota do GLM Coding Plan).
export function migrateLegacyProfiles(profiles: LlmProfile[]): { profiles: LlmProfile[]; changed: boolean } {
  const defaults = new Map(defaultLlmProfiles().map((p) => [p.id, p]));
  let changed = false;
  const migrated = profiles.map((p) => {
    const def = defaults.get(p.id);
    if (!def) return p;
    const baseUrl = p.baseUrl.trim();
    const legacy =
      (p.id === "kimi" && baseUrl === KIMI_LEGACY_BASE_URL) ||
      (p.id === "zai" && baseUrl === config.gatewayUrl.trim());
    if (!legacy) return p;
    changed = true;
    return { ...def, label: p.label || def.label };
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
