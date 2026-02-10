import { existsSync } from "node:fs";
import { Router } from "express";
import { executionManager } from "../../execution-manager.js";
import { getAgentPaths } from "../../agents/manager.js";
import { config } from "../../config.js";
import { loadOrchestratorSettings } from "../../orchestrator-settings.js";
import { safeProjectPath } from "../../session.js";

export const executionsRouter = Router();

executionsRouter.get("/", (req, res) => {
  const status = req.query.status as string | undefined;
  const active = executionManager.getActiveExecutions();
  const recent = executionManager.getRecentExecutions(100);

  if (status === "active") {
    res.json(active);
    return;
  }

  res.json({ active, recent });
});

executionsRouter.post("/", (req, res) => {
  const { targetType, targetName, prompt, resumeSessionId } = req.body;

  if (!prompt || !targetType) {
    res.status(400).json({ error: "prompt and targetType required" });
    return;
  }

  let cwd: string;
  if (targetType === "agent") {
    const paths = getAgentPaths(targetName);
    if (!paths || !existsSync(paths.root)) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    cwd = paths.root;
  } else if (targetType === "project") {
    const projectPath = safeProjectPath(targetName);
    if (!projectPath || !existsSync(projectPath)) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    cwd = projectPath;
  } else {
    cwd = config.orchestratorPath;
  }

  let finalPrompt = prompt;
  let model: string | undefined;

  if (targetType === "orchestrator") {
    const settings = loadOrchestratorSettings();
    if (settings.prependPrompt) {
      finalPrompt = `${settings.prependPrompt}\n\n${prompt}`;
    }
    if (settings.model) {
      model = settings.model;
    }
  }

  const id = executionManager.startExecution({
    source: "web",
    targetType,
    targetName: targetName || "orchestrator",
    prompt: finalPrompt,
    cwd,
    resumeSessionId,
    model,
  });

  res.status(201).json({ id });
});

executionsRouter.get("/target-status", (_req, res) => {
  const active = executionManager.getActiveExecutions();
  const recent = executionManager.getRecentExecutions(100);

  const statusMap: Record<string, { running: boolean; lastStatus: "completed" | "error" | "cancelled" | null }> = {};

  for (const exec of recent) {
    const key = `${exec.targetType}:${exec.targetName}`;
    statusMap[key] = {
      running: false,
      lastStatus: exec.status as "completed" | "error" | "cancelled",
    };
  }

  for (const exec of active) {
    const key = `${exec.targetType}:${exec.targetName}`;
    statusMap[key] = {
      running: true,
      lastStatus: statusMap[key]?.lastStatus ?? null,
    };
  }

  res.json(statusMap);
});

executionsRouter.post("/:id/stop", (req, res) => {
  const { id } = req.params;
  const cancelled = executionManager.cancelExecution(id);

  if (!cancelled) {
    res.status(404).json({ error: "Execution not found or already completed" });
    return;
  }

  res.json({ cancelled: true });
});
