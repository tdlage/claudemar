import { Bot } from "grammy";
import { registerCommands } from "./commands.js";
import { config } from "./config.js";
import { processMessage } from "./processor.js";
import {
  isBusy,
  setBusy,
} from "./session.js";
import { transcribeAudio } from "./transcription.js";

const BUSY_MSG = "Já existe uma execução em andamento. Aguarde ou use /cancel.";
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

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const chatId = ctx.chat.id;

  if (isBusy(chatId)) {
    await ctx.reply(BUSY_MSG);
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

  if (isBusy(chatId)) {
    await ctx.reply(BUSY_MSG);
    return;
  }

  setBusy(chatId, true);
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

    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `🎤 "${preview}"\n\nExecutando...`,
    );

    const prompt = `[Mensagem de áudio transcrita]: ${transcribedText}`;
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
    setBusy(chatId, false);
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});
