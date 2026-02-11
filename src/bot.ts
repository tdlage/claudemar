import { Bot } from "grammy";
import { registerCommands } from "./commands.js";
import { config } from "./config.js";
import { executionManager } from "./execution-manager.js";
import { loadOrchestratorSettings } from "./orchestrator-settings.js";
import { processMessage } from "./processor.js";
import { commandQueue, type QueueItem } from "./queue.js";
import {
  getActiveAgent,
  getMode,
  getSession,
  getSessionId,
  getWorkingDirectory,
  setBusy,
} from "./session.js";
import { transcribeAudio } from "./transcription.js";

const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

export const bot = new Bot(config.telegramBotToken);

bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.allowedChatId) {
    console.log(`Unauthorized access attempt from chat ${ctx.chat?.id}`);
    return;
  }
  await next();
});

registerCommands(bot);

function resolveTarget(chatId: number) {
  const mode = getMode(chatId);
  const activeAgent = getActiveAgent(chatId);
  const session = getSession(chatId);
  const targetType = mode === "agents" && activeAgent ? "agent" as const : session.activeProject ? "project" as const : "orchestrator" as const;
  const targetName = mode === "agents" && activeAgent ? activeAgent : session.activeProject ?? "orchestrator";
  return { targetType, targetName };
}

function buildExecutionOpts(chatId: number, text: string) {
  const cwd = getWorkingDirectory(chatId);
  const { targetType, targetName } = resolveTarget(chatId);

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

  return { targetType, targetName, cwd, finalPrompt, model };
}

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const chatId = ctx.chat.id;
  const { targetType, targetName, cwd, finalPrompt, model } = buildExecutionOpts(chatId, text);

  if (executionManager.isTargetActive(targetType, targetName)) {
    const item = commandQueue.enqueue({
      targetType,
      targetName,
      prompt: finalPrompt,
      source: "telegram",
      cwd,
      resumeSessionId: getSessionId(chatId),
      model,
      telegramChatId: chatId,
    });
    const preview = text.length > 60 ? text.slice(0, 60) + "..." : text;
    await ctx.reply(`Adicionado a fila (#${item.seqId}). "${preview}"\nUse /queue para ver a fila.`);
    return;
  }

  setBusy(chatId, true);
  const statusMsg = await ctx.reply("Executando...");
  await processMessage(ctx, chatId, text, statusMsg);
});

bot.on(["message:voice", "message:audio"], async (ctx) => {
  const chatId = ctx.chat.id;

  if (!config.openaiApiKey) {
    await ctx.reply(
      "OPENAI_API_KEY não configurada. Adicione ao .env para usar mensagens de voz.",
    );
    return;
  }

  const statusMsg = await ctx.reply("Transcrevendo áudio...");

  try {
    const file = await ctx.getFile();
    const filePath = file.file_path;

    if (!filePath) {
      throw new Error("Não foi possível obter o arquivo de áudio.");
    }

    if (file.file_size && file.file_size > MAX_AUDIO_SIZE) {
      throw new Error("Arquivo de áudio excede o limite de 25MB do Whisper.");
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`;
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error("Falha ao baixar o arquivo de áudio.");
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const filename = filePath.split("/").pop() || "voice.ogg";

    const transcribedText = await transcribeAudio(audioBuffer, filename);

    if (!transcribedText.trim()) {
      throw new Error("Transcrição vazia — nenhum texto reconhecido no áudio.");
    }

    const preview = transcribedText.length > 100
      ? `${transcribedText.slice(0, 100)}...`
      : transcribedText;

    const prompt = `[Mensagem de áudio transcrita]: ${transcribedText}`;
    const { targetType, targetName, cwd, finalPrompt, model } = buildExecutionOpts(chatId, prompt);

    if (executionManager.isTargetActive(targetType, targetName)) {
      const item = commandQueue.enqueue({
        targetType,
        targetName,
        prompt: finalPrompt,
        source: "telegram",
        cwd,
        resumeSessionId: getSessionId(chatId),
        model,
        telegramChatId: chatId,
      });
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Adicionado a fila (#${item.seqId}). "${preview}"\nUse /queue para ver a fila.`,
      );
      return;
    }

    setBusy(chatId, true);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `"${preview}"\n\nExecutando...`,
    );

    await processMessage(ctx, chatId, prompt, statusMsg);
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
  }
});

commandQueue.on("queue:processing", (item: QueueItem) => {
  if (item.source !== "telegram" || !item.telegramChatId) return;
  const preview = item.prompt.length > 60 ? item.prompt.slice(0, 60) + "..." : item.prompt;
  bot.api.sendMessage(
    item.telegramChatId,
    `Iniciando da fila (#${item.seqId}): "${preview}"`,
  ).catch(() => {});
});

bot.catch((err) => {
  console.error("Bot error:", err);
});
