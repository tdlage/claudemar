import { config } from "./config.js";
import { bot } from "./bot.js";
import { executionManager, type ExecutionInfo } from "./execution-manager.js";
import { commandQueue } from "./queue.js";
import { runProcessManager } from "./run-process-manager.js";
import { secretsManager } from "./secrets-manager.js";
import { processQueueItem } from "./processor.js";
import { createDashboardServer } from "./server/index.js";
import { tokenManager } from "./server/token-manager.js";
import { regenerateOrchestratorClaudeMd } from "./orchestrator-init.js";
import { flushSessions } from "./session.js";
import { ensureAllAgentGitRepos } from "./agents/manager.js";

regenerateOrchestratorClaudeMd();
ensureAllAgentGitRepos();
await executionManager.loadRecent();

function drainQueue(_id: string, info: ExecutionInfo) {
  const key = commandQueue.targetKey(info.targetType, info.targetName);
  if (executionManager.isTargetActive(info.targetType, info.targetName)) return;
  const next = commandQueue.dequeue(key);
  if (!next) return;
  commandQueue.emit("queue:processing", next);
  try {
    processQueueItem(next);
  } catch (err) {
    console.error("[drainQueue] Failed to process queue item:", err);
  }
}

executionManager.on("complete", drainQueue);
executionManager.on("error", drainQueue);
executionManager.on("cancel", drainQueue);

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
  commandQueue.flush();
  runProcessManager.flush();
  secretsManager.flush();
  flushSessions();
  tokenManager.stop();
  bot.stop();
  httpServer.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
