import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { config } from "../../config.js";
import { getSessionSnapshot } from "../../session.js";
import { loadMetrics } from "../../metrics.js";
import { executionManager } from "../../execution-manager.js";
import { checkForUpdates, performUpdate, restartService } from "../../updater.js";

const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

let prevCpuIdle = 0;
let prevCpuTotal = 0;
let cachedCpu = 0;

function readCpuUsage(): number {
  try {
    const stat = readFileSync("/proc/stat", "utf-8");
    const cpuLine = stat.split("\n")[0];
    const parts = cpuLine.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);

    if (prevCpuTotal > 0) {
      const diffIdle = idle - prevCpuIdle;
      const diffTotal = total - prevCpuTotal;
      cachedCpu = diffTotal > 0 ? Math.round((1 - diffIdle / diffTotal) * 100) : 0;
    }

    prevCpuIdle = idle;
    prevCpuTotal = total;
    return cachedCpu;
  } catch {
    const cores = cpus();
    if (cores.length === 0) return 0;
    const avg = cores.reduce((sum, c) => {
      const total = Object.values(c.times).reduce((a, b) => a + b, 0);
      return sum + (1 - c.times.idle / total);
    }, 0) / cores.length;
    return Math.round(avg * 100);
  }
}

setInterval(readCpuUsage, 2000);
readCpuUsage();

systemRouter.get("/resources", (_req, res) => {
  try {
    const memInfo = readFileSync("/proc/meminfo", "utf-8");
    const getValue = (key: string) => {
      const match = memInfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? parseInt(match[1], 10) : 0;
    };
    const totalKb = getValue("MemTotal");
    const availableKb = getValue("MemAvailable");
    const usedKb = totalKb - availableKb;
    const ramPercent = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;

    res.json({ cpu: readCpuUsage(), ram: ramPercent });
  } catch {
    res.json({ cpu: 0, ram: 0 });
  }
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
