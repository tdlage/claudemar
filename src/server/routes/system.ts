import { Router } from "express";
import { config } from "../../config.js";
import { getSessionSnapshot } from "../../session.js";
import { loadMetrics } from "../../metrics.js";
import { executionManager } from "../../execution-manager.js";

export const systemRouter = Router();

systemRouter.get("/status", (_req, res) => {
  const snapshot = getSessionSnapshot(config.allowedChatId);
  const activeExecutions = executionManager.getActiveExecutions().length;

  res.json({
    ...snapshot,
    activeExecutions,
    uptime: process.uptime(),
  });
});

systemRouter.get("/metrics", (_req, res) => {
  const metrics = loadMetrics();
  res.json(metrics);
});
