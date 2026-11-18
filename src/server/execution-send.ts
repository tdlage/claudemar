import { executionManager } from "../execution-manager.js";
import { commandQueue } from "../queue.js";
import { messageText, parseImageBlocks, withText } from "../runtime/message-blocks.js";

export class ExecutionSendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type ExecutionSendOutcome =
  | { status: "sent" }
  | { status: "queued"; seqId: number }
  | { status: "restarted"; id: string };

export async function sendToExecution(execId: string, input: { text?: unknown; blocks?: unknown }): Promise<ExecutionSendOutcome> {
  const images = parseImageBlocks(input.blocks);
  const text = messageText(input.text, input.blocks);
  if (!text.trim() && images.length === 0) throw new ExecutionSendError("Mensagem vazia.", 400);
  const blocks = images.length > 0 ? withText(images, text) : undefined;

  if (executionManager.sendMessage(execId, blocks ?? text)) return { status: "sent" };

  const info = executionManager.getExecution(execId);
  if (!info) throw new ExecutionSendError("Execução não encontrada.", 404);

  const targetBusy = executionManager.isTargetActive(info.targetType, info.targetName);
  const hasQueued = commandQueue.getByTarget(info.targetType, info.targetName).length > 0;
  if (targetBusy || hasQueued) {
    const item = await commandQueue.enqueue({
      targetType: info.targetType,
      targetName: info.targetName,
      prompt: text,
      source: info.source,
      cwd: info.cwd,
      agentName: info.agentName,
      username: info.username,
      userId: info.userId,
      model: info.modelSelection,
      planMode: info.planMode || undefined,
      effort: info.effort,
      effortAuto: info.effortAuto,
      imageBlocks: images,
    });
    return { status: "queued", seqId: item.seqId };
  }

  const id = executionManager.startExecution({
    source: info.source,
    targetType: info.targetType,
    targetName: info.targetName,
    agentName: info.agentName,
    username: info.username,
    userId: info.userId,
    prompt: text,
    cwd: info.cwd,
    model: info.modelSelection,
    planMode: info.planMode,
    blocks,
    effort: info.effort,
    effortAuto: info.effortAuto,
  });
  return { status: "restarted", id };
}
