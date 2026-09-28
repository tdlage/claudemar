import type { QueueItem } from "./queue.js";
import type { AgentRuntime } from "./providers/llm.js";
import { resolveTargetModel } from "./target-model-settings.js";

export interface QueueItemView extends QueueItem {
  runtime?: AgentRuntime;
}

export function toQueueItemView(item: QueueItem): QueueItemView {
  try {
    const { profile, model } = resolveTargetModel(item.targetType, item.targetName, item.model);
    return { ...item, model, runtime: profile.runtime };
  } catch {
    return item;
  }
}
