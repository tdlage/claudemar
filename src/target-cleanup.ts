import { config } from "./config.js";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execute } from "./database.js";
import { executionManager } from "./execution-manager.js";
import { commandQueue } from "./queue.js";
import { deleteMemoryForTarget } from "./memory/session-memory.js";
import { pipelineManager } from "./pipeline-manager.js";
import { removePipelineCron } from "./pipeline-cron.js";
import { runProcessManager } from "./run-process-manager.js";
import { projectSettingsManager } from "./project-settings.js";
import { usersManager } from "./users-manager.js";
import { REPO_WORKTREES_ROOT, hiddenReposPath } from "./repositories.js";

function cancelActiveExecutions(targetType: string, targetName: string): void {
  for (const exec of executionManager.getActiveExecutions()) {
    if (exec.targetType !== targetType) continue;
    const isCommitPush = targetType === "project" && exec.targetName.startsWith(`__commitpush:${targetName}:`);
    if (exec.targetName === targetName || isCommitPush) {
      executionManager.cancelExecution(exec.id);
    }
  }
}

export async function purgeProjectData(projectName: string): Promise<void> {
  cancelActiveExecutions("project", projectName);
  await commandQueue.removeByTarget("project", projectName);

  const pipeline = await pipelineManager.getPipelineByProject(projectName);
  if (pipeline) {
    const plugins = await pipelineManager.listIntakePlugins(pipeline.id);
    for (const plugin of plugins) {
      removePipelineCron(plugin.id);
    }
    const cards = await pipelineManager.getCardsByPipeline(pipeline.id);
    for (const card of cards) {
      await pipelineManager.removeCardWorktrees(card);
    }
    await execute("DELETE FROM pipeline_pipelines WHERE id = ?", [pipeline.id]);
  }

  for (const cfg of runProcessManager.getAllConfigs()) {
    if (cfg.projectName === projectName) {
      runProcessManager.stopProcess(cfg.id);
      await runProcessManager.deleteConfig(cfg.id);
    }
  }

  await execute(
    "DELETE FROM execution_history WHERE target_type = 'project' AND (target_name = ? OR target_name LIKE ?)",
    [projectName, `__commitpush:${projectName}:%`],
  );
  await execute("DELETE FROM user_projects WHERE project_name = ?", [projectName]);
  await execute("DELETE FROM user_project_tabs WHERE project_name = ?", [projectName]);
  await usersManager.reload();

  await rm(hiddenReposPath(resolve(config.projectsPath, projectName)), { recursive: true, force: true });
  projectSettingsManager.removeProject(projectName);
  await rm(resolve(REPO_WORKTREES_ROOT, projectName), { recursive: true, force: true });
  await deleteMemoryForTarget({ targetType: "project", targetName: projectName });
}

export async function purgeAgentData(agentName: string): Promise<void> {
  cancelActiveExecutions("agent", agentName);
  await commandQueue.removeByTarget("agent", agentName);

  await execute("DELETE FROM agent_secrets WHERE agent_name = ?", [agentName]);
  await execute("DELETE FROM agent_secret_file_descriptions WHERE agent_name = ?", [agentName]);
  await execute(
    "DELETE FROM execution_history WHERE (target_type = 'agent' AND target_name = ?) OR agent_name = ?",
    [agentName, agentName],
  );
  await execute("DELETE FROM user_agents WHERE agent_name = ?", [agentName]);
  await usersManager.reload();

  await deleteMemoryForTarget({ targetType: "agent", targetName: agentName });
}
