import { DEFAULT_PROJECT_MODEL, inferRuntimeFromModel, normalizeModel } from "./models-discovery.js";
import { modelSelection, type ModelOption } from "./model-routing.js";
import type { AgentRuntime } from "./providers/llm.js";

export interface ModelActivity {
  id: string;
  targetType: string;
  targetName: string;
  startedAt: string | Date;
  model?: string;
  runtime?: AgentRuntime;
  providerId?: string;
  modelSelection?: string;
  sessionId?: string;
}

export function latestModelActivity(entries: ModelActivity[], type: string, name: string): ModelActivity | undefined {
  return entries.filter((entry) => entry.targetType === type && entry.targetName === name)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
}

export function modelFromActivity(activity: ModelActivity | undefined, models: ModelOption[], fallbackRuntime: AgentRuntime): string {
  const saved = models.find((model) => model.model === activity?.modelSelection);
  const runtime = activity?.runtime ?? saved?.runtime ?? (activity?.model ? inferRuntimeFromModel(activity.model) : fallbackRuntime);
  const providerId = activity?.providerId ?? saved?.providerId;
  const modelId = activity?.model ? normalizeModel(activity.model) : undefined;
  const matches = models.filter((model) => model.runtime === runtime && (model.modelId === modelId || model.model === activity?.model));
  const exact = providerId ? matches.find((model) => model.providerId === providerId) : matches.length === 1 ? matches[0] : undefined;
  if (exact) return exact.model;
  if (!modelId && saved) return saved.model;
  const fallback = runtime === "codex" ? "gpt-6-astra" : DEFAULT_PROJECT_MODEL;
  return models.find((model) => model.runtime === runtime && model.modelId === fallback)?.model
    ?? modelSelection(runtime === "codex" ? "codex" : "anthropic", fallback);
}
