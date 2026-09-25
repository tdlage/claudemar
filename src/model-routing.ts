import { getModelDisplayName, getNativeClaudeModels, getSelectableProjectModels, normalizeModel } from "./models-discovery.js";
import { isNativeAnthropic, type AgentRuntime, type LlmProfile } from "./providers/llm.js";

export interface ModelOption {
  model: string;
  modelId: string;
  displayName: string;
  providerId: string;
  providerLabel: string;
  runtime: AgentRuntime;
}

export function modelSelection(profileId: string, model: string): string {
  return `${encodeURIComponent(profileId)}::${model}`;
}

export function modelsForProfiles(profiles: LlmProfile[]): ModelOption[] {
  return profiles.flatMap((profile) => {
    const models = [
      ...(isNativeAnthropic(profile) ? getNativeClaudeModels() : getSelectableProjectModels(profile)).map((item) => item.model),
      profile.opusModel, profile.sonnetModel, profile.haikuModel,
    ].map((model) => model.trim()).filter(Boolean);
    return [...new Set(models)].map((modelId) => ({
      model: modelSelection(profile.id, modelId), modelId,
      displayName: getModelDisplayName(modelId),
      providerId: profile.id, providerLabel: profile.label, runtime: profile.runtime,
    }));
  });
}

export function resolveModelSelection(selection: string, profiles: LlmProfile[]): { profile: LlmProfile; model: string; selection: string } {
  const options = modelsForProfiles(profiles);
  const separator = selection.indexOf("::");
  const normalized = normalizeModel(separator < 0 ? selection : selection.slice(separator + 2));
  const normalizedSelection = separator < 0 ? normalized : `${selection.slice(0, separator)}::${normalized}`;
  let option = options.find((item) => item.model === selection || item.model === normalizedSelection);
  if (!option && separator < 0) {
    const matches = options.filter((item) => item.modelId === normalized);
    option = matches.find((item) => {
      const profile = profiles.find((p) => p.id === item.providerId)!;
      return isNativeAnthropic(profile) || (profile.runtime === "codex" && !profile.baseUrl);
    }) ?? (matches.length === 1 ? matches[0] : undefined);
  }
  if (!option) throw new Error("Modelo indisponível ou ambíguo. Escolha um modelo de um provider configurado.");
  return { profile: { ...profiles.find((p) => p.id === option.providerId)! }, model: option.modelId, selection: option.model };
}
