import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { resolve } from "node:path";
import { Router } from "express";
import { config } from "../../config.js";
import { requireAdmin } from "../middleware.js";
import { getEnvStatus, updateEnv } from "../../env-manager.js";
import { loadMetrics } from "../../metrics.js";
import { executionManager } from "../../execution-manager.js";
import { checkForUpdates, performUpdate, restartService } from "../../updater.js";
import { runProcessManager } from "../../run-process-manager.js";
import { settingsManager } from "../../settings-manager.js";
import { sessionNamesManager } from "../../session-names-manager.js";
import { usersManager } from "../../users-manager.js";
import { getDefaultProjectModel, getModelDisplayName, getSelectableProjectModels, DEFAULT_OPUS_DISPLAY } from "../../models-discovery.js";
import { isNativeAnthropic } from "../../providers/llm.js";
import { startClaudeLogin, completeClaudeLogin, getClaudeAuthStatus } from "../../claude/oauth-login.js";
import { getLastAuthError, clearLastAuthError } from "../../claude/claude-auth-state.js";
import { cancelCodexLogin, codexLogout, getCodexAuthStatus, getCodexLoginState, startCodexDeviceLogin } from "../../codex/auth.js";
import { clearLastCodexAuthError, getLastCodexAuthError } from "../../codex/codex-auth-state.js";
import { fetchCodexUsage } from "../../codex/usage.js";

const INSTALL_DIR = config.installDir;

export const systemRouter = Router();

systemRouter.get("/status", (_req, res) => {
  res.json({
    activeExecutions: executionManager.getActiveExecutions().length,
    draining: executionManager.isDraining(),
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

systemRouter.get("/metrics", async (_req, res) => {
  const metrics = await loadMetrics();
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

systemRouter.get("/env", requireAdmin, (_req, res) => {
  res.json(getEnvStatus());
});

systemRouter.post("/env", requireAdmin, (req, res) => {
  const values = req.body?.values;
  if (!values || typeof values !== "object") {
    res.status(400).json({ error: "values (object) required" });
    return;
  }
  const updated = updateEnv(values as Record<string, string>);
  if (updated.includes("ZAI_API_KEY")) {
    executionManager.invalidateLlmSessions();
  }
  res.json({ updated, restartRequired: updated.length > 0 });
});

systemRouter.post("/restart", requireAdmin, (_req, res) => {
  res.json({ restarting: true });
  setTimeout(() => restartService({
    onWaiting: (count) => console.log(`[restart] ${count} execução(ões) ativa(s), aguardando...`),
    onRestarting: () => console.log("[restart] Reiniciando serviço..."),
  }), 1500);
});

systemRouter.post("/update", async (_req, res) => {
  try {
    const result = await performUpdate();
    res.json(result);
    if (result.success) {
      setTimeout(() => restartService({
        onWaiting: (count) => {
          console.log(`[updater] ${count} active execution(s), waiting 30s before restart...`);
        },
        onRestarting: () => {
          console.log("[updater] No active executions, restarting service...");
        },
      }), 1500);
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Update failed" });
  }
});

type UsageProvider = "anthropic" | "openai";

interface UsageWindow {
  label: string;
  utilization: number;
  resetsAt: string | null;
}

interface TokenUsageData {
  provider: UsageProvider;
  windows: UsageWindow[];
}

const tokenUsageCache = new Map<UsageProvider, { data: TokenUsageData; fetchedAt: number }>();
const TOKEN_USAGE_TTL = 60_000;

function getClaudeAccessToken(): string | null {
  const credPath = resolve(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(credPath, "utf-8"));
    return raw?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

async function fetchAnthropicUsage(): Promise<TokenUsageData> {
  const token = getClaudeAccessToken();
  if (!token) throw new Error("No Claude credentials found");

  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claudemar/1.0",
    },
  });

  if (!response.ok) throw new Error(`Anthropic API returned ${response.status}`);

  const json = await response.json() as Record<string, Record<string, unknown>>;
  return {
    provider: "anthropic",
    windows: [
      {
        label: "5h",
        utilization: (json.five_hour?.utilization as number) ?? 0,
        resetsAt: (json.five_hour?.resets_at as string) ?? null,
      },
      {
        label: "7d",
        utilization: (json.seven_day?.utilization as number) ?? 0,
        resetsAt: (json.seven_day?.resets_at as string) ?? null,
      },
    ],
  };
}

function usageWindowLabel(minutes: number | null, index: number): string {
  if (minutes === 300) return "5h";
  if (minutes === 10_080) return "7d";
  if (minutes && minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60}h`;
  return index === 0 ? "Primary" : "Secondary";
}

async function fetchOpenAiUsage(): Promise<TokenUsageData> {
  const windows = await fetchCodexUsage();
  return {
    provider: "openai",
    windows: windows.map((window, index) => ({
      label: usageWindowLabel(window.windowDurationMins, index),
      utilization: window.usedPercent,
      resetsAt: window.resetsAt ? new Date(window.resetsAt * 1_000).toISOString() : null,
    })),
  };
}

systemRouter.get("/token-usage", async (req, res) => {
  const force = req.query.force === "1";
  const provider: UsageProvider = req.query.provider === "openai" ? "openai" : "anthropic";
  const cached = tokenUsageCache.get(provider);
  if (!force && cached && Date.now() - cached.fetchedAt < TOKEN_USAGE_TTL) {
    res.json(cached.data);
    return;
  }

  try {
    const data = provider === "openai" ? await fetchOpenAiUsage() : await fetchAnthropicUsage();
    tokenUsageCache.set(provider, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    res.json({ error: err instanceof Error ? err.message : "Failed to fetch usage" });
  }
});

systemRouter.get("/claude-auth", (_req, res) => {
  res.json({ ...getClaudeAuthStatus(), authError: getLastAuthError() });
});

systemRouter.post("/claude-login/start", (_req, res) => {
  try {
    res.json(startClaudeLogin());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao iniciar login" });
  }
});

systemRouter.post("/claude-login/complete", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  try {
    const result = await completeClaudeLogin(code);
    clearLastAuthError();
    tokenUsageCache.delete("anthropic");
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Falha ao concluir login" });
  }
});

systemRouter.get("/model", (_req, res) => {
  const resolved = executionManager.getResolvedModelId();
  const id = resolved ?? "opus";
  const displayName = resolved ? getModelDisplayName(resolved) : DEFAULT_OPUS_DISPLAY;
  res.json({ id, displayName, runtime: settingsManager.getActiveProfile().runtime });
});

async function providerConfigured(): Promise<boolean> {
  const profile = settingsManager.getActiveProfile();
  if (profile.baseUrl.trim()) return !profile.tokenEnv.trim() || Boolean(process.env[profile.tokenEnv.trim()]);
  if (profile.runtime === "codex") return (await getCodexAuthStatus()).loggedIn;
  const auth = getClaudeAuthStatus();
  return auth.present && !auth.expired;
}

systemRouter.get("/provider", async (_req, res) => {
  const profile = settingsManager.getActiveProfile();
  const selectableModels = getSelectableProjectModels(profile);
  res.json({
    provider: profile.id,
    label: profile.label,
    runtime: profile.runtime,
    model: profile.opusModel || "auto",
    nativeAnthropic: isNativeAnthropic(profile),
    defaultModel: getDefaultProjectModel(profile),
    selectableModels,
    configured: await providerConfigured(),
  });
});

systemRouter.get("/codex-auth", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  res.json({ ...(await getCodexAuthStatus(force)), authError: getLastCodexAuthError() });
});

systemRouter.post("/codex-login/start", (_req, res) => {
  try {
    res.json(startCodexDeviceLogin());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao iniciar login" });
  }
});

systemRouter.get("/codex-login/state", (_req, res) => {
  const state = getCodexLoginState();
  if (state.status === "done") {
    clearLastCodexAuthError();
    tokenUsageCache.delete("openai");
  }
  res.json(state);
});

systemRouter.post("/codex-login/cancel", (_req, res) => {
  res.json(cancelCodexLogin());
});

systemRouter.post("/codex-logout", async (_req, res) => {
  try {
    await codexLogout();
    tokenUsageCache.delete("openai");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao desconectar" });
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

systemRouter.post("/reload-configs", async (_req, res) => {
  await runProcessManager.reload();
  settingsManager.reload();
  await sessionNamesManager.reload();
  await usersManager.reload();
  console.log("[system] All configs reloaded");
  res.json({ reloaded: true });
});
