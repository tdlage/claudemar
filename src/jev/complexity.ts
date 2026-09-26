import type { AgentRuntime } from "../providers/llm.js";
import type { Effort } from "../runtime/types.js";
import { jevDecide, type JevQuestion } from "./client.js";

const MAX_REQUEST_CHARS = 16_000;
const MAX_PREVIOUS_CHARS = 2_000;

const COMPLEXITY_QUESTION = {
  type: "score",
  instructions: "Rate how much reasoning effort an autonomous AI coding agent needs to fully accomplish the latest request. Judge the work the request implies, not the length of the text. When the latest request is a short follow-up (an approval, an answer, 'continue', 'go ahead'), rate the work it authorizes using the earlier requests as context.",
  criteria: [
    "Low effort: greeting, thanks, a yes/no or quick factual question, or anything answerable directly without touching code or running tools.",
    "Medium effort: a small, well-specified action in one place, such as renaming, tweaking a value, reading a file, running one command, or explaining a short snippet.",
    "High effort: a clear task following existing patterns, touching a few files or needing a short investigation, with low risk.",
    "Extra high effort: a feature or bug fix that requires understanding several parts of the codebase, coordinated edits across files, and verification.",
    "Max effort: multi-step work with design decisions, ambiguous requirements, integration with external systems, cross-cutting changes, or hard debugging.",
    "Ultracode effort: large architecture-level work such as major refactors, migrations or new subsystems across many modules, requiring extensive planning and parallel exploration.",
  ],
} as const satisfies JevQuestion;

const MAX_COMPLEXITY = COMPLEXITY_QUESTION.criteria.length - 1;

const EFFORT_BY_COMPLEXITY: Record<AgentRuntime, readonly Effort[]> = {
  claude: ["low", "low", "medium", "high", "extra", "max"],
  codex: ["low", "low", "medium", "high", "extra", "max"],
};

export interface ComplexityAssessment {
  complexity: number;
  confidence: number;
  effort: Effort;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n[…]\n${text.slice(-half)}`;
}

export async function assessComplexity(request: string, previousRequests: string[], runtime: AgentRuntime): Promise<ComplexityAssessment> {
  const state = {
    latest_request: clip(request, MAX_REQUEST_CHARS),
    ...(previousRequests.length > 0 && { previous_requests: previousRequests.map((prompt) => clip(prompt, MAX_PREVIOUS_CHARS)) }),
  };
  const { answers } = await jevDecide(state, { complexity: COMPLEXITY_QUESTION });
  const complexity = Math.min(MAX_COMPLEXITY, Math.max(0, Math.round(answers.complexity.score)));
  return { complexity, confidence: answers.complexity.confidence, effort: EFFORT_BY_COMPLEXITY[runtime][complexity] };
}
