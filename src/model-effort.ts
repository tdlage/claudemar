import { EFFORTS, type Effort } from "./runtime/types.js";

const SONNET_MINIMUM_EFFORT: Effort = "extra";

export function isSonnetModel(model?: string | null): boolean {
  return /sonnet/i.test(model ?? "");
}

export function effortForModel(model: string | undefined, effort: Effort | undefined): Effort | undefined {
  if (!isSonnetModel(model)) return effort;
  if (!effort || EFFORTS.indexOf(effort) < EFFORTS.indexOf(SONNET_MINIMUM_EFFORT)) return SONNET_MINIMUM_EFFORT;
  return effort;
}
