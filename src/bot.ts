import { Bot } from "grammy";
import { registerCommands } from "./commands.js";
import { config } from "./config.js";

export const bot = new Bot(config.telegramBotToken);

bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.allowedChatId) {
    console.log(`Unauthorized access attempt from chat ${ctx.chat?.id}`);
    return;
  }
  await next();
});

registerCommands(bot);

bot.catch((err) => {
  console.error("Bot error:", err);
});
