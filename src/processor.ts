import { existsSync } from "node:fs";
import { type Context, InputFile } from "grammy";
import { getAgentPaths } from "./agents/manager.js";
import { config } from "./config.js";
import {
  type ExecutionInfo,
  executionManager,
} from "./execution-manager.js";
import { loadOrchestratorSettings } from "./orchestrator-settings.js";
import type { QueueItem } from "./queue.js";
import { markdownToTelegramHtml } from "./telegram-format.js";
import {
  getActiveAgent,
  getMode,
  getSession,
  getSessionId,
  getWorkingDirectory,
  setBusy,
  setSessionId,
} from "./session.js";

export async function processMessage(
  ctx: Context,
  chatId: number,
  text: string,
  statusMsg: { message_id: number },
): Promise<void> {
  try {
    const cwd = getWorkingDirectory(chatId);

    if (!existsSync(cwd)) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        "Projeto não encontrado. Use /project.",
      );
      return;
    }

    const mode = getMode(chatId);
    const activeAgent = getActiveAgent(chatId);
    const session = getSession(chatId);
    const targetType = mode === "agents" && activeAgent ? "agent" as const : session.activeProject ? "project" as const : "orchestrator" as const;
    const targetName = mode === "agents" && activeAgent ? activeAgent : session.activeProject ?? "orchestrator";

    let finalPrompt = text;
    let model: string | undefined;

    if (targetType === "orchestrator") {
      const settings = loadOrchestratorSettings();
      if (settings.prependPrompt) {
        finalPrompt = `${settings.prependPrompt}\n\n${text}`;
      }
      if (settings.model) {
        model = settings.model;
      }
    }

    const execId = executionManager.startExecution({
      source: "telegram",
      targetType,
      targetName,
      prompt: finalPrompt,
      cwd,
      resumeSessionId: getSessionId(chatId),
      model,
    });

    await waitAndReply(ctx, chatId, execId, statusMsg);
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
  } finally {
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

    await waitAndReply(ctx, chatId, execId, statusMsg, agentName);
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
  } finally {
    setBusy(chatId, false);
  }
}

function waitAndReply(
  ctx: Context,
  chatId: number,
  execId: string,
  statusMsg: { message_id: number },
  agentLabel?: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const prefix = agentLabel ? `[${agentLabel}] ` : "";

    const onComplete = async (id: string, info: ExecutionInfo) => {
      if (id !== execId) return;
      cleanup();

      try {
        const result = info.result;
        if (!result) {
          resolve();
          return;
        }

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
          resolve();
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
        console.error(`[waitAndReply] onComplete error: ${msg}`);
        try {
          await ctx.api.editMessageText(chatId, statusMsg.message_id, `${prefix}Concluído (erro ao enviar resposta).`);
        } catch { /* last resort */ }
      }

      resolve();
    };

    const onError = async (id: string, _info: ExecutionInfo, message: string) => {
      if (id !== execId) return;
      cleanup();

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

      resolve();
    };

    const onCancel = async (id: string) => {
      if (id !== execId) return;
      cleanup();
      resolve();
    };

    function cleanup() {
      executionManager.off("complete", onComplete);
      executionManager.off("error", onError);
      executionManager.off("cancel", onCancel);
    }

    executionManager.on("complete", onComplete);
    executionManager.on("error", onError);
    executionManager.on("cancel", onCancel);
  });
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
  });
}
