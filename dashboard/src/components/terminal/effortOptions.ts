import type { AgentRuntime } from "../../lib/types";

export type Effort = "minimal" | "low" | "medium" | "high" | "extra" | "max" | "ultracode";

export interface EffortOption {
  value: Effort;
  label: string;
  description: string;
  isDefault?: boolean;
}

const CLAUDE_EFFORTS: EffortOption[] = [
  { value: "low", label: "Low", description: "Faster responses for simple tasks" },
  { value: "medium", label: "Medium", description: "Balanced for routine work" },
  { value: "high", label: "High", description: "Best balance of quality and speed", isDefault: true },
  { value: "extra", label: "Extra high", description: "Deeper reasoning for coding and agents" },
  { value: "max", label: "Max", description: "Most thorough reasoning" },
  { value: "ultracode", label: "Ultracode", description: "Extended reasoning with workflow orchestration for coding" },
];

const OPENAI_EFFORTS: EffortOption[] = [
  { value: "minimal", label: "Instant", description: "Fast responses for everyday work" },
  { value: "medium", label: "Medium", description: "Standard reasoning", isDefault: true },
  { value: "high", label: "High", description: "Extended reasoning for complex tasks" },
  { value: "extra", label: "Extra High", description: "Deeper reasoning for demanding tasks" },
  { value: "max", label: "Max", description: "Maximum reasoning effort" },
];

export function effortOptionsFor(runtime: AgentRuntime): EffortOption[] {
  return runtime === "codex" ? OPENAI_EFFORTS : CLAUDE_EFFORTS;
}

export function normalizeEffortFor(runtime: AgentRuntime, effort: Effort): Effort {
  const options = effortOptionsFor(runtime);
  if (options.some((option) => option.value === effort)) return effort;

  if (runtime === "codex") {
    if (effort === "low") return "minimal";
    if (effort === "ultracode") return "max";
    return "medium";
  }

  if (effort === "minimal") return "low";
  return "high";
}

export function defaultEffortFor(runtime: AgentRuntime): Effort {
  return runtime === "codex" ? "medium" : "high";
}
