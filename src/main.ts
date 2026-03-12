import "./migrate-data.js";
import { config } from "./config.js";
import { bot } from "./bot.js";
import { executionManager, type ExecutionInfo } from "./execution-manager.js";
import { commandQueue } from "./queue.js";
import { runProcessManager } from "./run-process-manager.js";
import { processQueueItem } from "./processor.js";
import { createDashboardServer } from "./server/index.js";
import { tokenManager } from "./server/token-manager.js";
import { regenerateOrchestratorClaudeMd } from "./orchestrator-init.js";
import { initSessions } from "./session.js";
import { usersManager } from "./users-manager.js";
import { sessionNamesManager } from "./session-names-manager.js";
import { ensureAllAgentGitRepos, generateAgentsContext } from "./agents/manager.js";
import { generateSendEmailScript, ensureCredentialsDir } from "./email-init.js";
import { modelPreferences } from "./model-preferences.js";
import { settingsManager } from "./settings-manager.js";
import { runTrackerMigrations } from "./tracker-migration.js";
import { runDataMigrations } from "./data-migration.js";
import { initTrackerExecutionBridge } from "./tracker-execution-bridge.js";
import { closePool } from "./database.js";

regenerateOrchestratorClaudeMd();
ensureCredentialsDir();
generateSendEmailScript();
ensureAllAgentGitRepos();
generateAgentsContext();
await runTrackerMigrations().catch((err) => {
  console.error("[tracker] Migration failed (MySQL may not be configured):", err.message);
});
await runDataMigrations().catch((err) => {
  console.error("[data-migration] Migration failed:", err.message);
});
await usersManager.initialize();
await sessionNamesManager.initialize();
await commandQueue.initialize();
await runProcessManager.initialize();
await initSessions();
await executionManager.loadRecent();
await initTrackerExecutionBridge();

async function drainQueue(_id: string, info: ExecutionInfo) {
  try {
    const key = commandQueue.targetKey(info.targetType, info.targetName);
    if (executionManager.isTargetActive(info.targetType, info.targetName)) return;
    const next = await commandQueue.dequeue(key);
    if (!next) return;
    commandQueue.emit("queue:processing", next);
    processQueueItem(next);
  } catch (err) {
    console.error("[drainQueue] Failed:", err);
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
  runProcessManager.flush();
  settingsManager.flush();
  modelPreferences.flush();
  tokenManager.stop();
  closePool().catch(() => {});
  bot.stop();
  httpServer.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
