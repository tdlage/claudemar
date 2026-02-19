import { type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { type AskQuestion, type ClaudeResult, type SpawnHandle, spawnClaude } from "./executor.js";
import { type HistoryEntry, appendHistory, loadHistory } from "./history.js";
import { routeMessages, routeOrchestratorMessages, buildInboxPrompt, archiveInboxMessages } from "./agents/messenger.js";
import { getAgentPaths } from "./agents/manager.js";
import { config } from "./config.js";
import { trackExecution } from "./metrics.js";
import { secretsManager } from "./secrets-manager.js";

export type ExecutionSource = "telegram" | "web";
export type ExecutionTargetType = "orchestrator" | "project" | "agent";
export type ExecutionStatus = "running" | "completed" | "error" | "cancelled";

export interface PendingQuestion {
  toolUseId: string;
  questions: AskQuestion[];
}

export interface ExecutionInfo {
  id: string;
  source: ExecutionSource;
  targetType: ExecutionTargetType;
  targetName: string;
  agentName?: string;
  prompt: string;
  cwd: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  output: string;
  result: ClaudeResult | null;
  error: string | null;
  pendingQuestion: PendingQuestion | null;
  planMode: boolean;
}

export interface StartExecutionOpts {
  source: ExecutionSource;
  targetType: ExecutionTargetType;
  targetName: string;
  prompt: string;
  cwd: string;
  resumeSessionId?: string | null;
  noResume?: boolean;
  timeoutMs?: number;
  model?: string;
  planMode?: boolean;
  isInboxProcessing?: boolean;
  agentName?: string;
  useDocker?: boolean;
}

const MAX_RECENT = 100;
const MAX_STREAM_OUTPUT = 1024 * 1024;
const MAX_SESSION_HISTORY = 5;

const MAX_PERSISTED_OUTPUT = 50_000;
const MAX_MEMORY_OUTPUT = 200_000;

function buildHistoryEntry(info: ExecutionInfo, overrides?: Partial<Pick<HistoryEntry, "costUsd" | "durationMs">>): HistoryEntry {
  const durationMs = overrides?.durationMs
    ?? (info.completedAt ? info.completedAt.getTime() - info.startedAt.getTime() : 0);
  const output = info.output.length > MAX_PERSISTED_OUTPUT
    ? info.output.slice(0, MAX_PERSISTED_OUTPUT) + "\n...(truncated)"
    : info.output;
  return {
    id: info.id,
    prompt: info.prompt,
    targetType: info.targetType,
    targetName: info.targetName,
    agentName: info.agentName || undefined,
    status: info.status,
    startedAt: info.startedAt.toISOString(),
    completedAt: info.completedAt?.toISOString() ?? null,
    costUsd: overrides?.costUsd ?? 0,
    durationMs,
    source: info.source,
    output: output || undefined,
    error: info.error,
    sessionId: info.result?.sessionId || undefined,
    planMode: info.planMode || undefined,
  };
}

interface ActiveEntry {
  info: ExecutionInfo;
  process: ChildProcess;
  opts: StartExecutionOpts;
}

class ExecutionManager extends EventEmitter {
  private active = new Map<string, ActiveEntry>();
  private recent: ExecutionInfo[] = [];
  private pendingQuestions = new Map<string, { info: ExecutionInfo; opts: StartExecutionOpts }>();

  constructor() {
    super();
    this.setMaxListeners(50);
  }
  private lastSessionMap = new Map<string, string>();
  private sessionHistoryMap = new Map<string, string[]>();

  private targetKey(targetType: string, targetName: string): string {
    return `${targetType}:${targetName}`;
  }

  getLastSessionId(targetType: string, targetName: string): string | undefined {
    return this.lastSessionMap.get(this.targetKey(targetType, targetName));
  }

  getSessionHistory(targetType: string, targetName: string): string[] {
    return this.sessionHistoryMap.get(this.targetKey(targetType, targetName)) ?? [];
  }

  setActiveSessionId(targetType: string, targetName: string, sessionId: string): void {
    this.lastSessionMap.set(this.targetKey(targetType, targetName), sessionId);
  }

  clearSessionId(targetType: string, targetName: string): void {
    this.lastSessionMap.delete(this.targetKey(targetType, targetName));
  }

  private pushSessionHistory(targetType: string, targetName: string, sessionId: string): void {
    const key = this.targetKey(targetType, targetName);
    const list = this.sessionHistoryMap.get(key) ?? [];
    const filtered = list.filter((s) => s !== sessionId);
    filtered.unshift(sessionId);
    this.sessionHistoryMap.set(key, filtered.slice(0, MAX_SESSION_HISTORY));
  }

  startExecution(opts: StartExecutionOpts): string {
    const id = randomUUID();
    const info: ExecutionInfo = {
      id,
      source: opts.source,
      targetType: opts.targetType,
      targetName: opts.targetName,
      agentName: opts.agentName,
      prompt: opts.prompt,
      cwd: opts.cwd,
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      output: "",
      result: null,
      error: null,
      pendingQuestion: null,
      planMode: opts.planMode ?? false,
    };

    const resumeId = opts.noResume
      ? undefined
      : (opts.resumeSessionId ?? this.getLastSessionId(opts.targetType, opts.targetName));

    let systemSuffix = opts.useDocker
      ? ""
      : `\n\n[SYSTEM: You are confined to ${opts.cwd} — do NOT read, list, or access files outside this directory or its subdirectories. Never navigate to parent directories.]`;
    if (opts.targetType === "agent" || opts.targetType === "orchestrator") {
      systemSuffix += `\n[SYSTEM: Before executing, read your CLAUDE.md for your role and instructions, and context/agents.md to know the available agents and how to communicate with them via inbox/outbox.]`;
    }
    if (opts.targetType === "agent") {
      const secretsJsonPath = resolve(config.agentsPath, opts.targetName, "secrets.json");
      const secretFilePaths = secretsManager.getSecretFilePaths(opts.targetName);
      const hasSecrets = existsSync(secretsJsonPath);
      const hasFiles = Object.keys(secretFilePaths).length > 0;
      if (hasSecrets || hasFiles) {
        let secretsInfo = `\n[SYSTEM: You have secrets configured.`;
        if (hasSecrets) {
          secretsInfo += ` Read ${secretsJsonPath} for API keys, tokens, and credentials stored as key-value pairs.`;
        }
        if (hasFiles) {
          const fileList = Object.entries(secretFilePaths).map(([name, path]) => `  - ${name} → ${path}`).join("\n");
          secretsInfo += ` You also have secret files available:\n${fileList}`;
        }
        secretsInfo += `]`;
        systemSuffix += secretsInfo;
      }
    }
    const effectivePrompt = opts.prompt + systemSuffix;

    const handle: SpawnHandle = spawnClaude(
      effectivePrompt,
      opts.cwd,
      resumeId,
      opts.timeoutMs,
      (chunk: string) => {
        if (info.output.length < MAX_STREAM_OUTPUT) {
          info.output += chunk;
        }
        this.emit("output", id, chunk);
      },
      opts.model,
      (toolUseId: string, questions: AskQuestion[]) => {
        info.pendingQuestion = { toolUseId, questions };
        this.emit("question", id, info);
      },
      opts.planMode,
      opts.agentName,
      opts.useDocker,
    );

    this.active.set(id, { info, process: handle.process, opts });
    this.emit("start", id, info);

    handle.promise
      .then((result) => {
        if (info.status === "cancelled") return;
        info.completedAt = new Date();
        info.result = result;
        if (!info.output) {
          info.output = result.output;
        }
        if (result.sessionId) {
          this.lastSessionMap.set(this.targetKey(opts.targetType, opts.targetName), result.sessionId);
          this.pushSessionHistory(opts.targetType, opts.targetName, result.sessionId);
        }

        const askDenial = result.permissionDenials.find(
          (d) => d.tool_name === "AskUserQuestion",
        );

        if (askDenial) {
          info.status = "completed";
          info.pendingQuestion = {
            toolUseId: askDenial.tool_use_id,
            questions: askDenial.tool_input.questions,
          };
          this.finalize(id);
          this.pendingQuestions.set(id, { info, opts });
          this.emit("complete", id, info);
          this.emit("question", id, info);
          appendHistory(buildHistoryEntry(info, { costUsd: result.costUsd, durationMs: result.durationMs }));
        } else {
          info.status = "completed";
          info.pendingQuestion = null;
          this.finalize(id);
          this.emit("complete", id, info);
          appendHistory(buildHistoryEntry(info, { costUsd: result.costUsd, durationMs: result.durationMs }));
        }

        if (opts.targetType === "agent") {
          trackExecution(opts.targetName, result.costUsd, result.durationMs);
          if (opts.isInboxProcessing) {
            archiveInboxMessages(opts.targetName);
          }
          const agentRoute = routeMessages(opts.targetName);
          this.triggerInboxProcessing(agentRoute.destinations);
        } else if (opts.targetType === "orchestrator") {
          const orchRoute = routeOrchestratorMessages();
          this.triggerInboxProcessing(orchRoute.destinations);
        }
      })
      .catch((err) => {
        if (info.status === "cancelled") return;
        const message = err instanceof Error ? err.message : String(err);
        info.status = "error";
        info.completedAt = new Date();
        info.error = message;
        const durationMs = info.completedAt.getTime() - info.startedAt.getTime();
        info.result = {
          output: info.output,
          sessionId: resumeId ?? "",
          durationMs,
          costUsd: 0,
          isError: true,
          permissionDenials: [],
        };
        this.finalize(id);
        this.emit("error", id, info, message);

        appendHistory(buildHistoryEntry(info, { durationMs }));
      });

    return id;
  }

  submitAnswer(execId: string, answer: string): string | null {
    const pending = this.pendingQuestions.get(execId);
    if (!pending) return null;

    const { info, opts } = pending;
    const sessionId = info.result?.sessionId;
    if (!sessionId) return null;

    this.pendingQuestions.delete(execId);
    info.pendingQuestion = null;
    this.emit("question:answered", execId, info);

    const newExecId = this.startExecution({
      ...opts,
      prompt: answer,
      resumeSessionId: sessionId,
    });

    return newExecId;
  }

  getPendingQuestion(execId: string): PendingQuestion | null {
    return this.pendingQuestions.get(execId)?.info.pendingQuestion ?? null;
  }

  getAllPendingQuestions(): Array<{ execId: string; info: ExecutionInfo }> {
    return Array.from(this.pendingQuestions.entries()).map(([execId, { info }]) => ({ execId, info }));
  }

  cancelExecution(id: string): boolean {
    const entry = this.active.get(id);
    if (entry) {
      entry.info.status = "cancelled";
      entry.info.completedAt = new Date();
      entry.info.error = "Cancelado pelo usuário.";

      const sessionId = entry.opts.resumeSessionId
        ?? this.getLastSessionId(entry.opts.targetType, entry.opts.targetName)
        ?? "";
      if (sessionId) {
        const durationMs = entry.info.completedAt.getTime() - entry.info.startedAt.getTime();
        entry.info.result = {
          output: entry.info.output,
          sessionId,
          durationMs,
          costUsd: 0,
          isError: false,
          permissionDenials: [],
        };
        this.lastSessionMap.set(this.targetKey(entry.opts.targetType, entry.opts.targetName), sessionId);
        this.pushSessionHistory(entry.opts.targetType, entry.opts.targetName, sessionId);
      }

      entry.process.kill("SIGTERM");
      setTimeout(() => {
        if (!entry.process.killed) {
          entry.process.kill("SIGKILL");
        }
      }, 5000);

      this.finalize(id);
      this.emit("cancel", id, entry.info);
      appendHistory(buildHistoryEntry(entry.info));
      return true;
    }

    const pending = this.pendingQuestions.get(id);
    if (pending) {
      this.pendingQuestions.delete(id);
      pending.info.pendingQuestion = null;
      this.emit("question:answered", id, pending.info);
      return true;
    }

    return false;
  }

  getExecution(id: string): ExecutionInfo | undefined {
    return this.active.get(id)?.info ?? this.recent.find((e) => e.id === id);
  }

  isTargetActive(targetType: string, targetName: string): boolean {
    for (const entry of this.active.values()) {
      if (entry.info.targetType === targetType && entry.info.targetName === targetName) return true;
    }
    return false;
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

  async loadRecent(): Promise<void> {
    const entries = await loadHistory(MAX_RECENT);
    this.recent = entries.map((e) => ({
      id: e.id,
      source: (e.source as ExecutionSource) || "telegram",
      targetType: (e.targetType as ExecutionTargetType) || "orchestrator",
      targetName: e.targetName || "orchestrator",
      agentName: e.agentName,
      prompt: e.prompt,
      cwd: "",
      status: (e.status as ExecutionStatus) || "completed",
      startedAt: new Date(e.startedAt),
      completedAt: e.completedAt ? new Date(e.completedAt) : null,
      output: e.output ?? "",
      result: e.costUsd || e.durationMs ? {
        output: e.output ?? "",
        sessionId: e.sessionId ?? "",
        durationMs: e.durationMs,
        costUsd: e.costUsd,
        isError: e.status === "error",
        permissionDenials: [],
      } : null,
      error: e.error ?? null,
      pendingQuestion: null,
      planMode: e.planMode ?? false,
    }));

    for (const e of entries) {
      if (e.sessionId && e.status === "completed") {
        this.lastSessionMap.set(this.targetKey(e.targetType, e.targetName), e.sessionId);
        this.pushSessionHistory(e.targetType, e.targetName, e.sessionId);
      }
    }
  }

  private finalize(id: string): void {
    const entry = this.active.get(id);
    if (!entry) return;
    this.active.delete(id);
    if (entry.info.output.length > MAX_MEMORY_OUTPUT) {
      entry.info.output = entry.info.output.slice(0, MAX_MEMORY_OUTPUT) + "\n...(truncated)";
    }
    this.recent.push(entry.info);
    if (this.recent.length > MAX_RECENT) {
      this.recent.shift();
    }
  }

  private triggerInboxProcessing(destinations: string[]): void {
    for (const agentName of destinations) {
      if (this.isTargetActive("agent", agentName)) {
        console.log(`[inbox] ${agentName} is busy, skipping inbox trigger`);
        continue;
      }

      const inboxPrompt = buildInboxPrompt(agentName);
      if (!inboxPrompt) continue;

      const paths = getAgentPaths(agentName);
      if (!paths) continue;

      console.log(`[inbox] Triggering ${agentName} to process inbox messages`);
      this.startExecution({
        source: "web",
        targetType: "agent",
        targetName: agentName,
        prompt: inboxPrompt,
        cwd: paths.root,
        isInboxProcessing: true,
      });
    }
  }
}

export const executionManager = new ExecutionManager();
