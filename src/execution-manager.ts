import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { type ClaudeResult, type SpawnHandle, spawnClaude } from "./executor.js";
import { routeMessages } from "./agents/messenger.js";
import { trackExecution } from "./metrics.js";

export type ExecutionSource = "telegram" | "web";
export type ExecutionTargetType = "orchestrator" | "project" | "agent";
export type ExecutionStatus = "running" | "completed" | "error" | "cancelled";

export interface ExecutionInfo {
  id: string;
  source: ExecutionSource;
  targetType: ExecutionTargetType;
  targetName: string;
  prompt: string;
  cwd: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  output: string;
  result: ClaudeResult | null;
  error: string | null;
}

export interface StartExecutionOpts {
  source: ExecutionSource;
  targetType: ExecutionTargetType;
  targetName: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string | null;
  timeoutMs?: number;
}

const MAX_RECENT = 100;
const MAX_STREAM_OUTPUT = 1024 * 1024;

class ExecutionManager extends EventEmitter {
  private active = new Map<string, { info: ExecutionInfo; process: ChildProcess }>();
  private recent: ExecutionInfo[] = [];

  startExecution(opts: StartExecutionOpts): string {
    const id = randomUUID();
    const info: ExecutionInfo = {
      id,
      source: opts.source,
      targetType: opts.targetType,
      targetName: opts.targetName,
      prompt: opts.prompt,
      cwd: opts.cwd,
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      output: "",
      result: null,
      error: null,
    };

    const handle: SpawnHandle = spawnClaude(
      opts.prompt,
      opts.cwd,
      opts.resumeSessionId,
      opts.timeoutMs,
      (chunk: string) => {
        if (info.output.length < MAX_STREAM_OUTPUT) {
          info.output += chunk;
        }
        this.emit("output", id, chunk);
      },
    );

    this.active.set(id, { info, process: handle.process });
    this.emit("start", id, info);

    handle.promise
      .then((result) => {
        if (info.status === "cancelled") return;
        info.status = "completed";
        info.completedAt = new Date();
        info.result = result;
        info.output = result.output;
        this.finalize(id);
        this.emit("complete", id, info);

        if (opts.targetType === "agent") {
          trackExecution(opts.targetName, result.costUsd, result.durationMs);
          routeMessages(opts.targetName);
        }
      })
      .catch((err) => {
        if (info.status === "cancelled") return;
        const message = err instanceof Error ? err.message : String(err);
        info.status = "error";
        info.completedAt = new Date();
        info.error = message;
        this.finalize(id);
        this.emit("error", id, info, message);
      });

    return id;
  }

  cancelExecution(id: string): boolean {
    const entry = this.active.get(id);
    if (!entry) return false;

    entry.info.status = "cancelled";
    entry.info.completedAt = new Date();
    entry.info.error = "Cancelado pelo usuário.";
    entry.process.kill("SIGTERM");
    setTimeout(() => {
      if (!entry.process.killed) {
        entry.process.kill("SIGKILL");
      }
    }, 5000);

    this.finalize(id);
    this.emit("cancel", id, entry.info);
    return true;
  }

  getExecution(id: string): ExecutionInfo | undefined {
    return this.active.get(id)?.info ?? this.recent.find((e) => e.id === id);
  }

  getActiveExecutions(): ExecutionInfo[] {
    return Array.from(this.active.values()).map((e) => e.info);
  }

  getRecentExecutions(limit = 50): ExecutionInfo[] {
    return this.recent.slice(-limit);
  }

  getProcess(id: string): ChildProcess | undefined {
    return this.active.get(id)?.process;
  }

  private finalize(id: string): void {
    const entry = this.active.get(id);
    if (!entry) return;
    this.active.delete(id);
    if (entry.info.output.length > 10_000) {
      entry.info.output = entry.info.output.slice(0, 10_000) + "\n...(truncated)";
    }
    this.recent.push(entry.info);
    if (this.recent.length > MAX_RECENT) {
      this.recent.shift();
    }
  }
}

export const executionManager = new ExecutionManager();
