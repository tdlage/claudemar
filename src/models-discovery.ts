import { isNativeAnthropic, type LlmProfile } from "./providers/llm.js";

export const DEFAULT_OPUS_DISPLAY = "Opus 5";

interface DiscoveredModel {
  id: string;
  displayName: string;
  createdAt: string;
  provider: "claude";
}

const CLAUDE_DEFAULT_MODELS: DiscoveredModel[] = [
  { id: "claude-opus-5", displayName: "Opus 5", createdAt: "", provider: "claude" },
  { id: "claude-fable-5-1", displayName: "Fable 5.1", createdAt: "", provider: "claude" },
  { id: "claude-sonnet-5", displayName: "Sonnet 5", createdAt: "", provider: "claude" },
  { id: "claude-opus-4-8", displayName: "Opus 4.8", createdAt: "", provider: "claude" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", createdAt: "", provider: "claude" },
  { id: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", createdAt: "", provider: "claude" },
];

// Modelos Claude escolhíveis por projeto (só se aplicam ao provider nativo "anthropic").
// Usamos ids explícitos aceitos diretamente pelo Agent SDK. O alias "opus" não é usado
// porque a versão instalada do SDK ainda o expande para claude-opus-4-8, não para o Opus 5.
export const PROJECT_SELECTABLE_MODELS = [
  { model: "claude-opus-5", displayName: "Opus 5" },
  { model: "claude-fable-5-1", displayName: "Fable 5.1" },
] as const;

export const DEFAULT_PROJECT_MODEL = "claude-opus-5";

// Valores legados já persistidos (alias "opus", Fable 5) apontam para os modelos atuais.
const LEGACY_MODELS: Record<string, string> = {
  opus: DEFAULT_PROJECT_MODEL,
  "claude-fable-5": "claude-fable-5-1",
};

export function normalizeModel(model: string): string {
  return LEGACY_MODELS[model] ?? model;
}

export function isSelectableProjectModel(model: unknown): model is string {
  return typeof model === "string" && PROJECT_SELECTABLE_MODELS.some((m) => m.model === model);
}

// Regra única de resolução do modelo de uma execução. Override explícito sempre vence.
// Para projetos com provider nativo anthropic, usa a preferência do projeto. Para qualquer
// outro provider ou alvo não-projeto, usa o modelo principal do perfil ativo.
export function resolveExecutionModel(params: {
  explicitModel?: string;
  targetType: string;
  activeProfile: LlmProfile;
  projectModel: string;
}): string {
  if (params.explicitModel) return normalizeModel(params.explicitModel);
  if (params.targetType === "project" && isNativeAnthropic(params.activeProfile)) {
    return normalizeModel(params.projectModel);
  }
  return params.activeProfile.opusModel.trim() || DEFAULT_PROJECT_MODEL;
}

function formatDisplayName(id: string): string {
  const versioned = id.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (versioned) {
    const [, tier, major, minor] = versioned;
    return `${tier.charAt(0).toUpperCase() + tier.slice(1)} ${major}.${minor}`;
  }
  const dateless = id.match(/^claude-(\w+)-(\d+)$/);
  if (dateless) {
    const [, tier, version] = dateless;
    return `${tier.charAt(0).toUpperCase() + tier.slice(1)} ${version}`;
  }
  return id;
}

export function getModelDisplayName(id: string): string {
  if (!id || id === "opus") return DEFAULT_OPUS_DISPLAY;
  const known = CLAUDE_DEFAULT_MODELS.find((m) => m.id === id);
  if (known) return known.displayName;
  return formatDisplayName(id);
}
