import { existsSync } from "node:fs";
import { type Context, InputFile } from "grammy";
import { getAgentPaths } from "./agents/manager.js";
import { config } from "./config.js";
import {
  type ExecutionInfo,
  type ExecutionTargetType,
  executionManager,
} from "./execution-manager.js";
import type { QueueItem } from "./queue.js";
import { markdownToTelegramHtml } from "./telegram-format.js";
import {
  getSessionId,
  setBusy,
  setSessionId,
} from "./session.js";

export interface MessageOpts {
  targetType: ExecutionTargetType;
  targetName: string;
  cwd: string;
  prompt: string;
  model?: string;
  planMode?: boolean;
  resumeSessionId?: string;
}

export async function processMessage(
  ctx: Context,
  chatId: number,
  opts: MessageOpts,
  statusMsg: { message_id: number },
): Promise<void> {
  try {
    if (!existsSync(opts.cwd)) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        "Projeto não encontrado. Use /project.",
      );
      setBusy(chatId, false);
      return;
    }

    const execId = executionManager.startExecution({
      source: "telegram",
      targetType: opts.targetType,
      targetName: opts.targetName,
      prompt: opts.prompt,
      cwd: opts.cwd,
      resumeSessionId: opts.resumeSessionId ?? getSessionId(chatId),
      model: opts.model,
      planMode: opts.planMode,
    });

    fireAndForgetReply(ctx, chatId, execId, statusMsg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Erro: ${message}`,
      );
    } catch {
      // non-critical
    }
    setBusy(chatId, false);
  }
}

export async function processDelegation(
  ctx: Context,
  chatId: number,
  agentName: string,
  prompt: string,
  statusMsg: { message_id: number },
): Promise<void> {
  try {
    const paths = getAgentPaths(agentName);
    if (!paths || !existsSync(paths.root)) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Agente "${agentName}" não encontrado.`,
      );
      return;
    }

    const execId = executionManager.startExecution({
      source: "telegram",
      targetType: "agent",
      targetName: agentName,
      prompt,
      cwd: paths.root,
    });

    fireAndForgetReply(ctx, chatId, execId, statusMsg, agentName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `[${agentName}] Erro: ${message}`,
      );
    } catch {
      // non-critical
    }
    setBusy(chatId, false);
  }
}

function fireAndForgetReply(
  ctx: Context,
  chatId: number,
  execId: string,
  statusMsg: { message_id: number },
  agentLabel?: string,
): void {
  const prefix = agentLabel ? `[${agentLabel}] ` : "";

  const onComplete = async (id: string, info: ExecutionInfo) => {
    if (id !== execId) return;
    cleanup();
    setBusy(chatId, false);

    try {
      const result = info.result;
      if (!result) return;

      if (result.sessionId) {
        setSessionId(chatId, result.sessionId);
      }

      const durationSec = (result.durationMs / 1000).toFixed(1);
      const footer = `${prefix}${durationSec}s · $${result.costUsd.toFixed(2)}`;

      if (!result.output) {
        try {
          await ctx.api.editMessageText(
            chatId,
            statusMsg.message_id,
            `${prefix}Executado sem output.\n\n${footer}`,
          );
        } catch { /* non-critical */ }
        return;
      }

      if (result.output.length > config.maxOutputLength) {
        try {
          const buffer = Buffer.from(result.output);
          const sizeKb = (buffer.byteLength / 1024).toFixed(1);
          const filename = agentLabel ? `${agentLabel}-response.txt` : "response.txt";
          await ctx.replyWithDocument(
            new InputFile(buffer, filename),
            { caption: `${prefix}Resposta grande (${sizeKb} KB)\n\n${footer}` },
          );
        } catch {
          await ctx.reply(`${prefix}Resposta grande demais para enviar.\n\n${footer}`);
        }
      } else {
        const raw = agentLabel ? `[${agentLabel}]\n${result.output}` : result.output;
        const html = agentLabel
          ? `<b>[${agentLabel}]</b>\n${markdownToTelegramHtml(result.output)}`
          : markdownToTelegramHtml(result.output);
        try {
          await ctx.reply(html, { parse_mode: "HTML" });
        } catch {
          try {
            await ctx.reply(raw);
          } catch {
            await ctx.reply(`${prefix}Resposta não pôde ser exibida (formato inválido).\n\n${footer}`);
          }
        }
      }

      try {
        await ctx.api.editMessageText(chatId, statusMsg.message_id, footer);
      } catch { /* non-critical */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fireAndForgetReply] onComplete error: ${msg}`);
      try {
        await ctx.api.editMessageText(chatId, statusMsg.message_id, `${prefix}Concluído (erro ao enviar resposta).`);
      } catch { /* last resort */ }
    }
  };

  const onError = async (id: string, _info: ExecutionInfo, message: string) => {
    if (id !== execId) return;
    cleanup();
    setBusy(chatId, false);

    try {
      if (message.includes("não encontrado no PATH")) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `${prefix}Claude CLI não encontrado no PATH.`,
        );
      } else {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `${prefix}Erro: ${message}`,
        );
      }
    } catch {
      try {
        await ctx.reply(`${prefix}Erro: ${message}`);
      } catch { /* last resort */ }
    }
  };

  const onCancel = async (id: string) => {
    if (id !== execId) return;
    cleanup();
    setBusy(chatId, false);
  };

  function cleanup() {
    executionManager.off("complete", onComplete);
    executionManager.off("error", onError);
    executionManager.off("cancel", onCancel);
  }

  executionManager.on("complete", onComplete);
  executionManager.on("error", onError);
  executionManager.on("cancel", onCancel);
}

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
    useDocker: item.useDocker,
  });
}
