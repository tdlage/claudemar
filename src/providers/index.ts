import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import type { ProviderAdapter, ProviderName } from "./types.js";

export function getProvider(name: ProviderName): ProviderAdapter {
  return name === "claude" ? claudeProvider : codexProvider;
}

export { resolveProvider } from "./types.js";
export type {
  AgentResult,
  AskQuestion,
  LineParser,
  ParserCallbacks,
  PermissionDenial,
  ProviderAdapter,
  ProviderName,
  QuestionOption,
  SpawnOptions,
} from "./types.js";
