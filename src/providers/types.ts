import { config } from "../config.js";

export type ProviderName = "claude" | "codex";

export interface QuestionOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: { questions: AskQuestion[] };
}

export interface AgentResult {
  output: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  isError: boolean;
  errorMessages: string[];
  permissionDenials: PermissionDenial[];
}

export interface SpawnOptions {
  prompt: string;
  model?: string;
  resumeSessionId?: string;
  planMode?: boolean;
  agentName?: string;
  inDocker?: boolean;
}

export interface ParserCallbacks {
  onChunk?: (chunk: string) => void;
  onQuestion?: (toolUseId: string, questions: AskQuestion[]) => void;
  onSessionId?: (sessionId: string) => void;
}

export interface LineParser {
  feedLine(line: string): void;
  partialOutput(): string;
  finish(exitCode: number | null): AgentResult | null;
}

export interface ProviderAdapter {
  name: ProviderName;
  binary: string;
  displayName: string;
  buildArgs(opts: SpawnOptions): string[];
  dockerArgs(): string[];
  createParser(callbacks: ParserCallbacks): LineParser;
}

export function resolveProvider(model?: string): ProviderName {
  if (model) {
    if (model.startsWith("claude")) return "claude";
    if (model === "codex" || model === "chat-latest" || model.startsWith("gpt")) return "codex";
  }
  return config.defaultProvider;
}
