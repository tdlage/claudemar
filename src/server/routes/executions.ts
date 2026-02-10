import { existsSync } from "node:fs";
import { Router } from "express";
import { executionManager } from "../../execution-manager.js";
import { getAgentPaths } from "../../agents/manager.js";
import { config } from "../../config.js";
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

  const id = executionManager.startExecution({
    source: "web",
    targetType,
    targetName: targetName || "orchestrator",
    prompt,
    cwd,
    resumeSessionId,
  });

  res.status(201).json({ id });
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
