import { existsSync } from "node:fs";
import { Bot, InputFile } from "grammy";
import { registerCommands } from "./commands.js";
import { config } from "./config.js";
import { spawnClaude } from "./executor.js";
import {
  getSessionId,
  getWorkingDirectory,
  isBusy,
  setActiveProcess,
  setBusy,
  setSessionId,
} from "./session.js";

const bot = new Bot(config.telegramBotToken);

bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.allowedChatId) {
    console.log(`Unauthorized access attempt from chat ${ctx.chat?.id}`);
    return;
  }
  await next();
});

registerCommands(bot);

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const chatId = ctx.chat.id;

  if (isBusy(chatId)) {
    await ctx.reply("Já existe uma execução em andamento. Aguarde ou use /cancel.");
    return;
  }

  setBusy(chatId, true);
  const statusMsg = await ctx.reply("Executando...");

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

    const sessionId = getSessionId(chatId);
    const handle = spawnClaude(text, cwd, sessionId);
    setActiveProcess(chatId, handle.process);

    const result = await handle.promise;
    setActiveProcess(chatId, null);

    if (result.sessionId) {
      setSessionId(chatId, result.sessionId);
    }

    const durationSec = (result.durationMs / 1000).toFixed(1);
    const footer = `${durationSec}s · $${result.costUsd.toFixed(2)}`;

    if (!result.output) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Executado sem output.\n\n${footer}`,
      );
      return;
    }

    if (result.output.length > config.maxOutputLength) {
      const buffer = Buffer.from(result.output);
      const sizeKb = (buffer.byteLength / 1024).toFixed(1);
      await ctx.replyWithDocument(
        new InputFile(buffer, "response.txt"),
        { caption: `Resposta grande (${sizeKb} KB)\n\n${footer}` },
      );
    } else {
      await ctx.reply(result.output);
    }

    try {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, footer);
    } catch {
      // non-critical
    }
  } catch (err) {
    setActiveProcess(chatId, null);
    const message = err instanceof Error ? err.message : String(err);

    try {
      if (message.includes("não encontrado no PATH")) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          "Claude CLI não encontrado no PATH.",
        );
      } else if (message.includes("Timeout")) {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          message,
        );
      } else {
        await ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `Erro: ${message}`,
        );
      }
    } catch {
      // status message edit failed, non-critical
    }
  } finally {
    setBusy(chatId, false);
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

process.on("SIGINT", () => bot.stop());
process.on("SIGTERM", () => bot.stop());

console.log("Claudemar starting...");
bot.start();
