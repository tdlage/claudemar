import { executionManager } from "./execution-manager.js";
import type { QueueItem } from "./queue.js";

export function processQueueItem(item: QueueItem): string {
  return executionManager.startExecution({
    source: item.source,
    targetType: item.targetType,
    targetName: item.targetName,
    prompt: item.prompt,
    cwd: item.cwd,
    resumeSessionId: item.resumeSessionId,
    model: item.model,
    planMode: item.planMode,
    agentName: item.agentName,
    username: item.username,
    skipSystemPrompt: item.skipSystemPrompt,
    effort: item.effort,
  });
}
