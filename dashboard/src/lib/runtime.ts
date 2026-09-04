import type { AgentRuntime } from "./types";

export function inferRuntime(model?: string): AgentRuntime {
  return /^(?:gpt-|chatgpt-|codex-|o\d)/i.test(model?.trim() ?? "") ? "codex" : "claude";
}

export function resolveRuntime(runtime?: AgentRuntime, model?: string): AgentRuntime {
  return runtime ?? inferRuntime(model);
}

export function runtimeLabel(runtime: AgentRuntime): "Codex" | "Claude" {
  return runtime === "codex" ? "Codex" : "Claude";
}
