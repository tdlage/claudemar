export const DEFAULT_OPUS_DISPLAY = "Opus 4.8";

interface DiscoveredModel {
  id: string;
  displayName: string;
  createdAt: string;
  provider: "claude";
}

const CLAUDE_DEFAULT_MODELS: DiscoveredModel[] = [
  { id: "claude-opus-4-8", displayName: "Opus 4.8", createdAt: "", provider: "claude" },
  { id: "claude-fable-5", displayName: "Fable 5", createdAt: "", provider: "claude" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", createdAt: "", provider: "claude" },
  { id: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", createdAt: "", provider: "claude" },
];

// Modelos Claude escolhíveis por projeto (só se aplicam ao provider nativo "anthropic").
// Opus usa o alias "opus" para preservar o comportamento padrão (resolvido no system/init);
// Fable usa o id explícito, aceito diretamente pelo Agent SDK.
export const PROJECT_SELECTABLE_MODELS = [
  { model: "opus", displayName: "Opus 4.8" },
  { model: "claude-fable-5", displayName: "Fable 5" },
] as const;

export const DEFAULT_PROJECT_MODEL = "opus";

export function isSelectableProjectModel(model: unknown): model is string {
  return typeof model === "string" && PROJECT_SELECTABLE_MODELS.some((m) => m.model === model);
}

// Regra única de resolução do modelo de uma execução. Override explícito sempre vence; a
// preferência por projeto só vale para alvo "project" com o provider nativo "anthropic" ativo.
export function resolveExecutionModel(params: {
  explicitModel?: string;
  targetType: string;
  activeProviderId: string;
  projectModel: string;
}): string {
  if (params.explicitModel) return params.explicitModel;
  if (params.targetType !== "project") return DEFAULT_PROJECT_MODEL;
  if (params.activeProviderId !== "anthropic") return DEFAULT_PROJECT_MODEL;
  return params.projectModel;
}

function formatDisplayName(id: string): string {
  const match = id.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (!match) return id;
  const [, tier, major, minor] = match;
  const tierCapitalized = tier.charAt(0).toUpperCase() + tier.slice(1);
  return `${tierCapitalized} ${major}.${minor}`;
}

export function getModelDisplayName(id: string): string {
  if (!id || id === "opus") return DEFAULT_OPUS_DISPLAY;
  const known = CLAUDE_DEFAULT_MODELS.find((m) => m.id === id);
  if (known) return known.displayName;
  return formatDisplayName(id);
}
