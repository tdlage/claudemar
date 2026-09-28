import type { AgentRuntime } from "../providers/llm.js";
import type { Effort } from "../runtime/types.js";

export const AUTO_EFFORT_OFFSETS = [-1, 0, 1] as const;
export type AutoEffortOffset = (typeof AUTO_EFFORT_OFFSETS)[number];

const EFFORT_LADDER: Record<AgentRuntime, readonly Effort[]> = {
  claude: ["low", "medium", "high", "extra", "max", "ultracode"],
  codex: ["low", "medium", "high", "extra", "max"],
};

export function isAutoEffortOffset(value: unknown): value is AutoEffortOffset {
  return AUTO_EFFORT_OFFSETS.includes(value as AutoEffortOffset);
}

export function applyEffortOffset(runtime: AgentRuntime, effort: Effort, offset: AutoEffortOffset): Effort {
  const ladder = EFFORT_LADDER[runtime];
  const index = ladder.indexOf(effort);
  if (index < 0) return effort;
  return ladder[Math.min(ladder.length - 1, Math.max(0, index + offset))];
}
