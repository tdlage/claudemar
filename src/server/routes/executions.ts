import { existsSync } from "node:fs";
import { Router } from "express";
import { executionManager } from "../../execution-manager.js";
import { getAgentPaths } from "../../agents/manager.js";
import { config } from "../../config.js";
import { loadOrchestratorSettings } from "../../orchestrator-settings.js";
import { commandQueue } from "../../queue.js";
import { resolveRepoPath } from "../../repositories.js";
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
  const { targetType, targetName, prompt, resumeSessionId, repoName, planMode, agentName, forceQueue, model: requestModel } = req.body;

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
    if (repoName) {
      const repoPath = resolveRepoPath(projectPath, repoName);
      if (!repoPath) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }
      cwd = repoPath;
    } else {
      cwd = projectPath;
    }
  } else {
    cwd = config.orchestratorPath;
  }

  let finalPrompt = prompt;
  let model: string | undefined = requestModel || undefined;

  if (targetType === "orchestrator") {
    const settings = loadOrchestratorSettings();
    if (settings.prependPrompt) {
      finalPrompt = `${settings.prependPrompt}\n\n${prompt}`;
    }
    if (!model && settings.model) {
      model = settings.model;
    }
  }

  const effectiveTargetName = targetName || "orchestrator";
  const queuePayload = {
    targetType,
    targetName: effectiveTargetName,
    prompt: finalPrompt,
    source: "web" as const,
    cwd,
    resumeSessionId,
    model,
    planMode,
    agentName,
  };

  const targetActive = executionManager.isTargetActive(targetType, effectiveTargetName);
  const hasQueuedItems = commandQueue.getByTarget(targetType, effectiveTargetName).length > 0;

  if (forceQueue && (targetActive || hasQueuedItems)) {
    const item = commandQueue.enqueue(queuePayload);
    res.status(202).json({ queued: true, queueItem: { id: item.id, seqId: item.seqId } });
    return;
  }

  if (!forceQueue && targetActive) {
    const item = commandQueue.enqueue(queuePayload);
    res.status(202).json({ queued: true, queueItem: { id: item.id, seqId: item.seqId } });
    return;
  }

  const id = executionManager.startExecution({
    ...queuePayload,
  });

  res.status(201).json({ id });
});

executionsRouter.get("/queue", (_req, res) => {
  res.json(commandQueue.getAll());
});

executionsRouter.delete("/queue/:seqId", (req, res) => {
  const seqId = parseInt(req.params.seqId, 10);
  if (Number.isNaN(seqId)) {
    res.status(400).json({ error: "Invalid seqId" });
    return;
  }

  const removed = commandQueue.remove(seqId);
  if (!removed) {
    res.status(404).json({ error: "Queue item not found" });
    return;
  }

  res.json({ removed: true, item: removed });
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

executionsRouter.get("/session/:targetType/:targetName", (req, res) => {
  const { targetType, targetName } = req.params;
  const sessionId = executionManager.getLastSessionId(targetType, targetName);
  const history = executionManager.getSessionHistory(targetType, targetName);
  res.json({ sessionId: sessionId ?? null, history });
});

executionsRouter.put("/session/:targetType/:targetName", (req, res) => {
  const { targetType, targetName } = req.params;
  const { sessionId } = req.body;
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId required" });
    return;
  }
  executionManager.setActiveSessionId(targetType, targetName, sessionId);
  res.json({ ok: true });
});

executionsRouter.delete("/session/:targetType/:targetName", (req, res) => {
  const { targetType, targetName } = req.params;
  executionManager.clearSessionId(targetType, targetName);
  res.json({ ok: true });
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

executionsRouter.post("/:id/answer", (req, res) => {
  const { id } = req.params;
  const { answer } = req.body;

  if (!answer || typeof answer !== "string") {
    res.status(400).json({ error: "answer (string) required" });
    return;
  }

  const newExecId = executionManager.submitAnswer(id, answer);
  if (!newExecId) {
    res.status(404).json({ error: "No pending question for this execution" });
    return;
  }

  res.status(201).json({ id: newExecId });
});

executionsRouter.get("/pending-questions", (_req, res) => {
  const questions = executionManager.getAllPendingQuestions();
  res.json(questions);
});
