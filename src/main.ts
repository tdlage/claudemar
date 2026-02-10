import { config } from "./config.js";
import { bot } from "./bot.js";
import { createDashboardServer } from "./server/index.js";

const httpServer = createDashboardServer();

const host = config.dashboardToken ? "0.0.0.0" : "127.0.0.1";
httpServer.listen(config.dashboardPort, host, () => {
  if (!config.dashboardToken) {
    console.log(`Dashboard running on http://localhost:${config.dashboardPort} (no token — localhost only)`);
  } else {
    console.log(`Dashboard running on http://0.0.0.0:${config.dashboardPort} (token protected)`);
  }
});

console.log("Claudemar starting...");
bot.start().catch((err) => {
  console.error("Telegram bot failed to start:", err.message);
  console.error("Dashboard is still running. Fix TELEGRAM_BOT_TOKEN in .env and restart.");
});

function shutdown() {
  console.log("Shutting down...");
  bot.stop();
  httpServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
