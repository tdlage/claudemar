import type { AgentRuntime, Effort } from "../../lib/types";

export type { Effort };
export type EffortSelection = Effort | "auto";

export interface EffortOption {
  value: EffortSelection;
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

const AUTO_EFFORT: EffortOption = { value: "auto", label: "Auto", description: "Jev rates each prompt's complexity and picks the effort" };

const OPENAI_EFFORTS: EffortOption[] = [
  { value: "minimal", label: "Instant", description: "Fast responses for everyday work" },
  { value: "medium", label: "Medium", description: "Standard reasoning", isDefault: true },
  { value: "high", label: "High", description: "Extended reasoning for complex tasks" },
  { value: "extra", label: "Extra High", description: "Deeper reasoning for demanding tasks" },
  { value: "max", label: "Max", description: "Maximum reasoning effort" },
];

export function effortOptionsFor(runtime: AgentRuntime, autoAvailable = false): EffortOption[] {
  const options = runtime === "codex" ? OPENAI_EFFORTS : CLAUDE_EFFORTS;
  return autoAvailable ? [AUTO_EFFORT, ...options] : options;
}

export function effortLabel(runtime: AgentRuntime, effort: EffortSelection): string {
  return effortOptionsFor(runtime, true).find((option) => option.value === effort)?.label ?? effort;
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

export function normalizeEffortSelection(runtime: AgentRuntime, selection: EffortSelection, autoAvailable: boolean): EffortSelection {
  if (selection === "auto") return autoAvailable ? "auto" : defaultEffortFor(runtime);
  return normalizeEffortFor(runtime, selection);
}

export function defaultEffortFor(runtime: AgentRuntime): Effort {
  return runtime === "codex" ? "medium" : "high";
}
