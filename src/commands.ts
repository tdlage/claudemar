import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { tokenManager } from "./server/token-manager.js";
import { checkForUpdates, performUpdate, restartService } from "./updater.js";

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function handleToken(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const token = tokenManager.getCurrentToken();
  await ctx.reply(token);
}

async function handleUpdate(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const statusMsg = await ctx.reply("Verificando atualizações...");

  try {
    const info = await checkForUpdates();

    if (!info.available) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Versão atual: <code>${info.currentCommit}</code> (${info.currentDate.split(" ")[0]})\n\nNenhuma atualização disponível.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const commitLines = info.commits
      .map((c) => {
        const hash = c.split(" ")[0];
        const msg = escapeHtml(c.slice(hash.length + 1));
        return `• <code>${hash}</code> ${msg}`;
      })
      .join("\n");

    const text = [
      `Versão atual: <code>${info.currentCommit}</code> (${info.currentDate.split(" ")[0]})`,
      "",
      `<b>${info.commitCount}</b> commit(s) novo(s):`,
      commitLines,
      "",
      `Nova versão: <code>${info.remoteCommit}</code>`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("Atualizar agora", "autoupdate:confirm")
      .text("Ignorar", "autoupdate:dismiss");

    await ctx.api.editMessageText(chatId, statusMsg.message_id, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `Erro ao verificar atualizações: ${message}`,
    );
  }
}

async function handleAutoUpdateCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const action = data.replace("autoupdate:", "");

  if (action === "dismiss") {
    await ctx.answerCallbackQuery({ text: "Atualização ignorada." });
    try {
      await ctx.editMessageText("Atualização ignorada.");
    } catch { }
    return;
  }

  if (action !== "confirm") return;

  await ctx.answerCallbackQuery({ text: "Iniciando atualização..." });
  try {
    await ctx.editMessageText("Atualizando... (isso pode levar alguns minutos)");
  } catch { }

  try {
    const result = await performUpdate();

    if (result.success) {
      await ctx.api.sendMessage(chatId, "Atualização concluída! Reiniciando serviço...");
      setTimeout(() => restartService({
        onWaiting: (count) => {
          ctx.api.sendMessage(chatId, `⏳ ${count} execução(ões) ativa(s). Aguardando para reiniciar... (nova tentativa em 30s)`).catch(() => {});
        },
        onRestarting: () => {
          ctx.api.sendMessage(chatId, "Reiniciando serviço agora...").catch(() => {});
        },
      }), 1000);
    } else {
      await ctx.api.sendMessage(
        chatId,
        `Falha na atualização:\n<pre>${escapeHtml(result.output)}</pre>`,
        { parse_mode: "HTML" },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.api.sendMessage(chatId, `Erro na atualização: ${message}`);
  }
}

export function registerCommands(bot: Bot): void {
  bot.command("token", handleToken);
  bot.command("update", handleUpdate);
  bot.callbackQuery(/^autoupdate:/, handleAutoUpdateCallback);
}
