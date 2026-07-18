import "./migrate-data.js";
import { existsSync, readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { bot } from "./bot.js";
import { executionManager, type ExecutionInfo } from "./execution-manager.js";
import { commandQueue } from "./queue.js";
import { runProcessManager } from "./run-process-manager.js";
import { processQueueItem } from "./processor.js";
import { createDashboardServer } from "./server/index.js";
import { tokenManager } from "./server/token-manager.js";
import { regenerateOrchestratorAgentsMd } from "./orchestrator-init.js";
import { usersManager } from "./users-manager.js";
import { sessionNamesManager } from "./session-names-manager.js";
import { ensureAllAgentGitRepos, cleanupLegacyMailboxes } from "./agents/manager.js";
import { generateSendEmailScript, ensureCredentialsDir } from "./email-init.js";
import { settingsManager } from "./settings-manager.js";
import { projectSettingsManager } from "./project-settings.js";
import { secretsManager } from "./secrets-manager.js";
import { runTrackerMigrations } from "./tracker-migration.js";
import { runPipelineMigrations } from "./pipeline-migration.js";
import { runDataMigrations } from "./data-migration.js";
import { initTrackerExecutionBridge } from "./tracker-execution-bridge.js";
import { initPipelineRunner } from "./pipeline-runner.js";
import { initClaudeAuthWatch } from "./claude/claude-auth-state.js";
import { initTeams } from "./agents/teams-manager.js";
import { ensureMemoryReady } from "./memory/session-memory.js";
import { gatewayManager } from "./providers/gateway.js";
import { closePool } from "./database.js";

function migrateClaudeMdToAgentsMd(): void {
  const dirs = [config.orchestratorPath];
  try {
    dirs.push(
      ...readdirSync(config.agentsPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => resolve(config.agentsPath, e.name)),
    );
  } catch { }
  for (const dir of dirs) {
    const claudeMd = resolve(dir, "CLAUDE.md");
    const agentsMd = resolve(dir, "AGENTS.md");
    if (existsSync(claudeMd) && !existsSync(agentsMd)) {
      renameSync(claudeMd, agentsMd);
      console.log(`[migrate] Renamed ${claudeMd} -> AGENTS.md`);
    }
  }
}

migrateClaudeMdToAgentsMd();
regenerateOrchestratorAgentsMd();
ensureCredentialsDir();
generateSendEmailScript();
ensureAllAgentGitRepos();
cleanupLegacyMailboxes();
await runTrackerMigrations().catch((err) => {
  console.error("[tracker] Migration failed (MySQL may not be configured):", err.message);
});
await runPipelineMigrations().catch((err) => {
  console.error("[pipeline] Migration failed (MySQL may not be configured):", err.message);
});
await runDataMigrations().catch((err) => {
  console.error("[data-migration] Migration failed:", err.message);
});
await usersManager.initialize();
await initTeams().catch((err) => {
  console.error("[teams] Initialization failed:", err.message);
});
await sessionNamesManager.initialize();
await commandQueue.initialize();
await runProcessManager.initialize();
await executionManager.loadRecent();
await initTrackerExecutionBridge();
initClaudeAuthWatch();
await initPipelineRunner().catch((err) => {
  console.error("[pipeline] Runner init failed:", err instanceof Error ? err.message : String(err));
});
await secretsManager.syncAllToFiles();
await ensureMemoryReady().catch((err) => {
  console.error("[memory] Initialization failed:", err instanceof Error ? err.message : String(err));
});
await gatewayManager.start().catch((err) => {
  console.error("[gateway] Initialization failed:", err instanceof Error ? err.message : String(err));
});
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
  projectSettingsManager.flush();
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
