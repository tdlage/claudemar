import { executionManager } from "./execution-manager.js";
import type { QueueItem } from "./queue.js";
import type { MessageBlock } from "./runtime/types.js";
import { loadQueueImages, removeQueueImages } from "./queue-attachments.js";

export function processQueueItem(item: QueueItem): string {
  try {
    return executionManager.startExecution({ ...executionOpts(item), ...imageOpts(item) });
  } finally {
    removeQueueImages(item.id);
  }
}

function imageOpts(item: QueueItem) {
  if (!item.images?.length) return {};
  const text: MessageBlock[] = item.prompt.trim() ? [{ type: "text", text: item.prompt }] : [];
  return { blocks: [...loadQueueImages(item.id, item.images), ...text], rawPrompt: item.prompt };
}

function executionOpts(item: QueueItem) {
  return {
    source: item.source,
    targetType: item.targetType,
    targetName: item.targetName,
    prompt: item.prompt,
    cwd: item.cwd,
    resumeSessionId: item.resumeSessionId,
    model: item.model,
    planMode: item.planMode,
    permissionMode: item.permissionMode,
    agentName: item.agentName,
    username: item.username,
    skipSystemPrompt: item.skipSystemPrompt,
    skipIsolationInstruction: item.skipIsolationInstruction,
    effort: item.effort,
    effortAuto: item.effortAuto,
  };
}
