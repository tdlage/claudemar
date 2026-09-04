import { spawn } from "node:child_process";
import { resolveCodexBinary } from "./auth.js";
import { stripCodexCredentials } from "./options.js";

const USAGE_TIMEOUT_MS = 15_000;

export interface CodexUsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function parseWindow(value: unknown): CodexUsageWindow | null {
  const raw = record(value);
  if (!raw || typeof raw.usedPercent !== "number" || !Number.isFinite(raw.usedPercent)) return null;
  return {
    usedPercent: raw.usedPercent,
    windowDurationMins: typeof raw.windowDurationMins === "number" ? raw.windowDurationMins : null,
    resetsAt: typeof raw.resetsAt === "number" ? raw.resetsAt : null,
  };
}

export function parseCodexUsage(result: unknown): CodexUsageWindow[] {
  const root = record(result);
  if (!root) return [];
  const byId = record(root.rateLimitsByLimitId);
  const snapshot = record(byId?.codex) ?? record(root.rateLimits);
  if (!snapshot) return [];
  return [parseWindow(snapshot.primary), parseWindow(snapshot.secondary)].filter((window): window is CodexUsageWindow => window !== null);
}

export function fetchCodexUsage(): Promise<CodexUsageWindow[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolveCodexBinary(), ["app-server"], {
      env: stripCodexCredentials(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    let settled = false;
    let initialized = false;
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      child.stdin?.removeAllListeners();
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      child.stdin?.end();
      if (!child.killed) child.kill();
    };
    const finish = (error: Error | null, windows: CodexUsageWindow[] = []) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolvePromise(windows);
    };
    const send = (message: Record<string, unknown>) => {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    };
    const handleLine = (line: string) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.id === 1 && !initialized) {
        if (message.error) {
          finish(new Error("Codex app-server initialization failed"));
          return;
        }
        initialized = true;
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 2 });
        return;
      }
      if (message.id !== 2) return;
      if (message.error) {
        const error = record(message.error);
        finish(new Error(typeof error?.message === "string" ? error.message : "OpenAI usage unavailable"));
        return;
      }
      const windows = parseCodexUsage(message.result);
      finish(windows.length > 0 ? null : new Error("OpenAI did not return usage windows"), windows);
    };
    const consume = (chunk: Buffer) => {
      output += chunk.toString("utf-8");
      const lines = output.split("\n");
      output = lines.pop() ?? "";
      for (const line of lines) handleLine(line.trim());
    };

    timer = setTimeout(() => finish(new Error("Timed out fetching OpenAI usage")), USAGE_TIMEOUT_MS);
    child.stdout?.on("data", consume);
    child.stdin?.on("error", (error) => finish(error));
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf-8")}`.slice(-2_000);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited with code ${code ?? "unknown"}`));
    });
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "claudemar", title: "Claudemar", version: "1.0.0" },
        capabilities: {},
      },
    });
  });
}
