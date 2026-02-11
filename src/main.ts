import { config } from "./config.js";
import { bot } from "./bot.js";
import { executionManager } from "./execution-manager.js";
import { createDashboardServer } from "./server/index.js";
import { tokenManager } from "./server/token-manager.js";
import { initOrchestratorClaudeMd } from "./orchestrator-init.js";

initOrchestratorClaudeMd();
await executionManager.loadRecent();

const httpServer = createDashboardServer();

httpServer.listen(config.dashboardPort, "0.0.0.0", () => {
  console.log(`Dashboard running on http://0.0.0.0:${config.dashboardPort} (use /token in Telegram)`);
});

console.log("Claudemar starting...");
bot.start().catch((err) => {
  console.error("Telegram bot failed to start:", err.message);
  console.error("Dashboard is still running. Fix TELEGRAM_BOT_TOKEN in .env and restart.");
});

function shutdown() {
  console.log("Shutting down...");
  tokenManager.stop();
  bot.stop();
  httpServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
