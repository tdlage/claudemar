import { executionManager } from "../execution-manager.js";
import { loadHistory } from "../history.js";
import type { AgentRuntime } from "../providers/llm.js";
import type { Effort } from "../runtime/types.js";
import { isJevConfigured } from "./client.js";
import { assessComplexity, type ComplexityAssessment } from "./complexity.js";

const CONTEXT_PROMPTS = 3;

interface SessionTarget {
  targetType: string;
  targetName: string;
  username: string;
}

async function recentSessionPrompts({ targetType, targetName, username }: SessionTarget): Promise<string[]> {
  const sessionId = executionManager.getLastSessionId(targetType, targetName, username);
  const history = sessionId ? await loadHistory(CONTEXT_PROMPTS, targetType, targetName, sessionId) : [];
  const running = executionManager.getActiveExecutions()
    .filter((e) => e.targetType === targetType && e.targetName === targetName && (e.username ?? "admin") === username);
  return [...history, ...running].map((e) => e.prompt).slice(-CONTEXT_PROMPTS);
}

export async function assessSessionComplexity(prompt: string, runtime: AgentRuntime, target: SessionTarget): Promise<ComplexityAssessment> {
  return assessComplexity(prompt, await recentSessionPrompts(target), runtime);
}

export async function automaticEffort(prompt: string, runtime: AgentRuntime, target: SessionTarget): Promise<Effort | undefined> {
  if (!isJevConfigured() || !prompt.trim()) return undefined;
  try {
    return (await assessSessionComplexity(prompt.trim(), runtime, target)).effort;
  } catch (err) {
    console.error("[jev] automatic effort failed:", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}
