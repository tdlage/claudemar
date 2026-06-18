import type { Bot, Context } from "grammy";
import { tokenManager } from "./server/token-manager.js";

async function handleToken(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const token = tokenManager.getCurrentToken();
  await ctx.reply(token);
}

export function registerCommands(bot: Bot): void {
  bot.command("token", handleToken);
}
