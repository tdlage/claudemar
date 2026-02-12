import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { config } from "../../config.js";
import { getSessionSnapshot } from "../../session.js";
import { loadMetrics } from "../../metrics.js";
import { executionManager } from "../../execution-manager.js";
import { checkForUpdates, performUpdate, restartService } from "../../updater.js";

const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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

systemRouter.get("/update-check", async (_req, res) => {
  try {
    const info = await checkForUpdates();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to check for updates" });
  }
});

systemRouter.post("/update", async (_req, res) => {
  try {
    const result = await performUpdate();
    res.json(result);
    if (result.success) {
      setTimeout(() => restartService(), 1500);
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Update failed" });
  }
});

systemRouter.get("/changelog", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  execFile(
    "git",
    ["log", `--max-count=${limit}`, "--format=%H%n%aI%n%s%n%b%n---END---"],
    { cwd: INSTALL_DIR, timeout: 10000 },
    (err, stdout) => {
      if (err) {
        res.status(500).json({ error: "Failed to read changelog" });
        return;
      }
      const entries = stdout
        .split("---END---\n")
        .filter(Boolean)
        .map((block) => {
          const lines = block.split("\n");
          return {
            hash: lines[0],
            date: lines[1],
            subject: lines[2],
            body: lines.slice(3).join("\n").trim(),
          };
        });
      res.json(entries);
    },
  );
});
