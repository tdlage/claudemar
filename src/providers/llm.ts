export type AgentRuntime = "claude" | "codex";

// Cada perfil escolhe o runtime das execuções e o parametriza por completo.
// - claude: Claude Agent SDK. baseUrl vazio = Anthropic nativo (subscription do Claude);
//   preenchido = qualquer endpoint compatível com a API da Anthropic (kimi, z.ai, ...).
// - codex: Codex SDK. baseUrl vazio = assinatura do ChatGPT (login do Codex, nunca API key);
//   preenchido = provedor OpenAI-compatible customizado autenticado por tokenEnv.
export interface LlmProfile {
  id: string;
  label: string;
  runtime: AgentRuntime;
  baseUrl: string;
  tokenEnv: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  timeoutMs: string;
  autoCompactWindow: string;
  extraEnv: string;
}

const DEFAULT_TIMEOUT_MS = "3000000";

const KIMI_BASE_URL = "https://api.kimi.com/coding";
// A documentação do Kimi Code diz que `k3[1m]` é o seletor usado pelo Claude Code
// para forçar a janela de 1M tokens. Para chamadas diretas à API Anthropic-compatível
// (que é o que o Agent SDK faz), o model ID correto é o bare `k3`; `k3[1m]` é
// interpretado pelo upstream como um modelo de 256K e retorna 400 quando o request
// passa de 262144 tokens.
const KIMI_MODEL = "k3";
const KIMI_LEGACY_BASE_URL = "https://api.moonshot.ai/anthropic";

// GLM Coding Plan: a quota da assinatura só vale no endpoint de coding Anthropic-compatible.
// O sufixo `[1m]` que a z.ai documenta para o Claude Code retorna 400 em chamadas diretas.
const ZAI_BASE_URL = "https://api.z.ai/api/anthropic";
const ZAI_MODEL = "glm-5.3";
const ZAI_HAIKU_MODEL = "glm-5.3-flash";

const CODEX_MODEL = "gpt-5.6-sol";
const CODEX_LIGHT_MODEL = "gpt-5.6-luna";

// Valores persistidos por versões anteriores: gateway Bifrost (removido) e o proxy local
// claude-codex que o perfil codex usava antes do runtime nativo do Codex SDK.
const LEGACY_GATEWAY_URLS = new Set(["http://localhost:8080/anthropic", "http://bifrost:8080/anthropic"]);
const LEGACY_GATEWAY_PROFILE_IDS = new Set(["openai", "sakana"]);
const CODEX_LEGACY_PROXY_URL = "http://127.0.0.1:18765";

export function defaultLlmProfiles(): LlmProfile[] {
  return [
    {
      id: "anthropic",
      label: "Anthropic (Claude)",
      runtime: "claude",
      baseUrl: "",
      tokenEnv: "",
      opusModel: "",
      sonnetModel: "",
      haikuModel: "",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      autoCompactWindow: "",
      extraEnv: "",
    },
    {
      id: "kimi",
      label: "Kimi (K3)",
      runtime: "claude",
      baseUrl: KIMI_BASE_URL,
      tokenEnv: "KIMI_API_KEY",
      opusModel: KIMI_MODEL,
      sonnetModel: KIMI_MODEL,
      haikuModel: KIMI_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      autoCompactWindow: "1048576",
      extraEnv: `CLAUDE_CODE_SUBAGENT_MODEL=${KIMI_MODEL}\nENABLE_TOOL_SEARCH=false`,
    },
    {
      id: "zai",
      label: "z.ai (GLM)",
      runtime: "claude",
      baseUrl: ZAI_BASE_URL,
      tokenEnv: "ZAI_API_KEY",
      opusModel: ZAI_MODEL,
      sonnetModel: ZAI_MODEL,
      haikuModel: ZAI_HAIKU_MODEL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      autoCompactWindow: "1000000",
      extraEnv: "",
    },
    {
      id: "codex",
      label: "OpenAI (ChatGPT)",
      runtime: "codex",
      baseUrl: "",
      tokenEnv: "",
      opusModel: CODEX_MODEL,
      sonnetModel: CODEX_MODEL,
      haikuModel: CODEX_LIGHT_MODEL,
      timeoutMs: "",
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
    runtime: r.runtime === "codex" ? "codex" : "claude",
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

export function isNativeAnthropic(profile: LlmProfile): boolean {
  return profile.runtime === "claude" && !profile.baseUrl.trim();
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

// Corrige perfis default cujos valores mudaram após já terem sido semeados e descarta os
// que dependiam do gateway removido. Só reescreve um perfil quando o baseUrl ainda é o
// legado (default intocado), preservando qualquer customização feita pelo usuário.
export function migrateLegacyProfiles(profiles: LlmProfile[]): { profiles: LlmProfile[]; changed: boolean } {
  const defaults = new Map(defaultLlmProfiles().map((p) => [p.id, p]));
  let changed = false;
  const migrated: LlmProfile[] = [];
  for (const p of profiles) {
    const baseUrl = p.baseUrl.trim();
    if (LEGACY_GATEWAY_PROFILE_IDS.has(p.id) && LEGACY_GATEWAY_URLS.has(baseUrl)) {
      changed = true;
      continue;
    }
    const def = defaults.get(p.id);
    const legacy =
      def !== undefined &&
      ((p.id === "kimi" && baseUrl === KIMI_LEGACY_BASE_URL) ||
        (p.id === "zai" && LEGACY_GATEWAY_URLS.has(baseUrl)) ||
        (p.id === "codex" && baseUrl === CODEX_LEGACY_PROXY_URL));
    if (!legacy) {
      migrated.push(p);
      continue;
    }
    changed = true;
    migrated.push({ ...def, label: p.label || def.label });
  }
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

// Ambiente do runtime claude. Sem baseUrl mantém o comportamento nativo (subscription do
// Claude). Com baseUrl, aponta o Agent SDK para o endpoint e fixa os modelos por alias.
// O extraEnv vale para qualquer perfil e é aplicado por último.
export function applyProfile(baseEnv: NodeJS.ProcessEnv, profile: LlmProfile): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const baseUrl = profile.baseUrl.trim();

  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    const token = profile.tokenEnv ? (process.env[profile.tokenEnv] ?? "").trim() : "";
    if (token) env.ANTHROPIC_AUTH_TOKEN = token;
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
