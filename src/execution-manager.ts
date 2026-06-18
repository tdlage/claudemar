import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AgentResult, AskQuestion } from "./providers/types.js";
import { ClaudeSession, type MessageBlock, type PendingPermission, type PermissionDecision, type UsageInfo } from "./claude/session.js";
import type { ThinkingLevel } from "./claude/options.js";
import { formatToolUse } from "./providers/format.js";
import { retrieveContext } from "./memory/session-memory.js";
import { type HistoryEntry, appendHistory, loadHistory } from "./history.js";
import { routeMessages, routeOrchestratorMessages, buildInboxPrompt, archiveInboxMessages, getInboxMessages } from "./agents/messenger.js";
import { getAgentPaths, listAgents } from "./agents/manager.js";
import { config } from "./config.js";
import { sessionNamesManager } from "./session-names-manager.js";
import { isEmailEnabled, getEmailScriptPath } from "./email-init.js";
import { settingsManager } from "./settings-manager.js";
import { emailSettingsManager } from "./email-settings-manager.js";
import { query } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

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
  model?: string;
  username?: string;
  prompt: string;
  cwd: string;
  status: ExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  output: string;
  result: AgentResult | null;
  error: string | null;
  pendingQuestion: PendingQuestion | null;
  planMode: boolean;
  resumeSessionId?: string | null;
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
  username?: string;
  skipSystemPrompt?: boolean;
  blocks?: MessageBlock[];
  thinking?: ThinkingLevel;
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
}

const MAX_RECENT = 100;
const MAX_STREAM_OUTPUT = 1024 * 1024;
const MAX_SESSION_HISTORY = 10;
const MAX_PERSISTED_OUTPUT = 50_000;
const MAX_MEMORY_OUTPUT = 200_000;
const DEFAULT_MODEL = "opus";

function buildHistoryEntry(info: ExecutionInfo, overrides?: Partial<Pick<HistoryEntry, "costUsd" | "totalTokens" | "durationMs">>): HistoryEntry {
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
    model: info.model || undefined,
    status: info.status,
    startedAt: info.startedAt.toISOString(),
    completedAt: info.completedAt?.toISOString() ?? null,
    costUsd: overrides?.costUsd ?? 0,
    totalTokens: overrides?.totalTokens ?? 0,
    durationMs,
    source: info.source,
    output: output || undefined,
    error: info.error,
    sessionId: info.result?.sessionId || undefined,
    planMode: info.planMode || undefined,
    username: info.username || undefined,
  };
}

interface ActiveEntry {
  info: ExecutionInfo;
  session: ClaudeSession;
  opts: StartExecutionOpts;
  sessionKey: string;
  detach?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
}

class ExecutionManager extends EventEmitter {
  private active = new Map<string, ActiveEntry>();
  private recent: ExecutionInfo[] = [];
  private pendingQuestions = new Map<string, { info: ExecutionInfo; opts: StartExecutionOpts }>();
  private sessions = new Map<string, ClaudeSession>();

  private lastSessionMap = new Map<string, string>();
  private lastSessionModelMap = new Map<string, string>();
  private sessionHistoryMap = new Map<string, string[]>();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  private targetKey(targetType: string, targetName: string): string {
    return `${targetType}:${targetName}`;
  }

  private userTargetKey(targetType: string, targetName: string, username?: string): string {
    return `${targetType}:${targetName}:${username ?? "admin"}`;
  }

  getLastSessionId(targetType: string, targetName: string, username?: string): string | undefined {
    return this.lastSessionMap.get(this.userTargetKey(targetType, targetName, username));
  }

  getLastSessionModel(targetType: string, targetName: string, username?: string): string | undefined {
    return this.lastSessionModelMap.get(this.userTargetKey(targetType, targetName, username));
  }

  getResolvedModelId(): string | undefined {
    for (const entry of this.active.values()) {
      const model = entry.session.getModel();
      if (model && model !== DEFAULT_MODEL) return model;
    }
    let latest: string | undefined;
    for (const model of this.lastSessionModelMap.values()) {
      if (model && model !== DEFAULT_MODEL) latest = model;
    }
    return latest;
  }

  getSessionHistory(targetType: string, targetName: string): string[] {
    return this.sessionHistoryMap.get(this.targetKey(targetType, targetName)) ?? [];
  }

  setActiveSessionId(targetType: string, targetName: string, username: string, sessionId: string): void {
    this.lastSessionMap.set(this.userTargetKey(targetType, targetName, username), sessionId);
  }

  clearSessionId(targetType: string, targetName: string, username: string): void {
    const key = this.userTargetKey(targetType, targetName, username);
    this.lastSessionMap.delete(key);
    this.lastSessionModelMap.delete(key);
    const session = this.sessions.get(key);
    if (session) {
      session.end();
      this.sessions.delete(key);
    }
  }

  async restoreLastSessions(): Promise<void> {
    const rows = await query<(RowDataPacket & {
      target_type: string; target_name: string; username: string; session_id: string; model: string | null;
    })[]>(
      `SELECT target_type, target_name, username, session_id, model
       FROM (
         SELECT target_type, target_name, COALESCE(username, 'admin') AS username, session_id, model,
                ROW_NUMBER() OVER (PARTITION BY target_type, target_name, COALESCE(username, 'admin') ORDER BY started_at DESC) AS rn
         FROM execution_history
         WHERE session_id IS NOT NULL AND status = 'completed'
       ) sub
       WHERE rn = 1`,
    );

    for (const row of rows) {
      const key = this.userTargetKey(row.target_type, row.target_name, row.username);
      this.lastSessionMap.set(key, row.session_id);
      this.lastSessionModelMap.set(key, row.model ?? DEFAULT_MODEL);
    }
  }

  private pushSessionHistory(targetType: string, targetName: string, sessionId: string): void {
    const key = this.targetKey(targetType, targetName);
    const list = this.sessionHistoryMap.get(key) ?? [];
    const filtered = list.filter((s) => s !== sessionId);
    filtered.unshift(sessionId);
    this.sessionHistoryMap.set(key, filtered.slice(0, MAX_SESSION_HISTORY));
  }

  private buildSystemSuffix(opts: StartExecutionOpts): string {
    if (opts.skipSystemPrompt) return "";
    let suffix = "";
    if (opts.targetType === "agent" || opts.targetType === "orchestrator") {
      suffix += `\n[SYSTEM: Before executing, read your AGENTS.md for your role and instructions, and context/agents.md to know the available agents and how to communicate with them via inbox/outbox.]`;
    }
    if (opts.targetType === "agent") {
      const secretsJsonPath = resolve(config.agentsPath, opts.targetName, "secrets.json");
      if (existsSync(secretsJsonPath)) {
        suffix += `\n[SYSTEM: You have secrets configured. Read ${secretsJsonPath} for credentials, API keys, and secret file paths.]`;
      }
    }
    if (opts.targetType === "project") {
      const projectInputDir = resolve(opts.cwd, ".input");
      if (existsSync(projectInputDir)) {
        try {
          const files = readdirSync(projectInputDir).filter((f) => !f.startsWith("."));
          if (files.length > 0) {
            suffix += `\n[SYSTEM: You have ${files.length} reference file(s) in ${projectInputDir}/. Check them if relevant to your task.]`;
          }
        } catch { }
      }
    }
    if (isEmailEnabled() && (opts.targetType === "agent" || opts.targetType === "orchestrator")) {
      const scriptPath = getEmailScriptPath();
      const { sesFrom } = settingsManager.get();
      const defaultFrom = sesFrom ? ` Default sender: ${sesFrom}.` : "";
      const profiles = emailSettingsManager.getProfiles();
      const senderList = profiles.map((p) => p.from).join(", ");
      const availableSenders = senderList ? ` Available senders: ${senderList}.` : "";
      suffix += `\n[SYSTEM: You can send emails. Usage: ${scriptPath} --to <email> --subject "<subject>" --body "<body>" [--from <sender-email>] [--html] [--cc <email>] [--attachment <filepath> ...]. Multiple --attachment flags supported.${defaultFrom}${availableSenders}]`;
    }
    return suffix;
  }

  private getOrCreateSession(opts: StartExecutionOpts, sessionKey: string, resumeId: string | undefined): { session: ClaudeSession; isNew: boolean } {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      const planChanged = Boolean(opts.planMode) !== existing.planMode;
      const agentChanged = (opts.agentName ?? "") !== (existing.agentName ?? "");
      const resumeChanged = Boolean(resumeId) && resumeId !== existing.getSessionId();
      if (existing.isAlive() && !planChanged && !agentChanged && !resumeChanged) {
        return { session: existing, isNew: false };
      }
      existing.end();
      this.sessions.delete(sessionKey);
    }

    const interactive = opts.source === "web" && !opts.isInboxProcessing && !opts.autoApprove;
    const bypass = opts.autoApprove || opts.permissionMode === "bypassPermissions" || (!opts.planMode && !interactive);
    const session = new ClaudeSession({
      cwd: opts.cwd,
      target: { targetType: opts.targetType, targetName: opts.targetName },
      agentName: opts.agentName,
      planMode: opts.planMode,
      permissionMode: opts.permissionMode,
      bypassPermissions: bypass,
      resumeSessionId: resumeId ?? null,
      thinking: opts.thinking,
      systemAppend: this.buildSystemSuffix(opts),
    });
    this.sessions.set(sessionKey, session);
    return { session, isNew: true };
  }

  private dropSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.end();
      this.sessions.delete(sessionKey);
    }
  }

  startExecution(opts: StartExecutionOpts): string {
    const id = randomUUID();
    const info: ExecutionInfo = {
      id,
      source: opts.source,
      targetType: opts.targetType,
      targetName: opts.targetName,
      agentName: opts.agentName,
      model: opts.model ?? DEFAULT_MODEL,
      username: opts.username,
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
      resumeSessionId: null,
    };

    const resumeId = opts.noResume
      ? undefined
      : opts.resumeSessionId === null
        ? undefined
        : (opts.resumeSessionId ?? this.getLastSessionId(opts.targetType, opts.targetName, opts.username));

    info.resumeSessionId = resumeId ?? null;

    const sessionKey = this.userTargetKey(opts.targetType, opts.targetName, opts.username);
    const { session, isNew } = this.getOrCreateSession(opts, sessionKey, resumeId);

    const entry: ActiveEntry = { info, session, opts, sessionKey };
    this.active.set(id, entry);

    this.wireSession(entry);

    const timeout = opts.timeoutMs ?? config.agentTimeoutMs;
    if (timeout > 0) {
      entry.timer = setTimeout(() => {
        entry.timedOut = true;
        entry.session.interrupt().catch(() => {});
      }, timeout);
    }

    const dispatch = async () => {
      let contextPrefix: string | undefined;
      if (isNew) {
        try {
          const memoryContext = await Promise.race([
            retrieveContext({ targetType: opts.targetType, targetName: opts.targetName }, opts.prompt),
            new Promise<string>((resolve) => setTimeout(() => resolve(""), 8000)),
          ]);
          if (memoryContext) contextPrefix = memoryContext;
        } catch { }
      } else if (opts.thinking) {
        await session.setThinking(opts.thinking).catch(() => {});
      }

      session.sendUserMessage(opts.blocks ?? opts.prompt, contextPrefix);
      const result = await session.waitForResult();
      if (entry.timedOut) {
        result.isError = true;
        result.errorMessages = [`Timeout após ${Math.round(timeout / 60000)} min.`];
      }
      this.handleResult(entry, result);
    };

    this.emit("start", id, info);
    dispatch().catch((err) => {
      this.handleFailure(entry, err instanceof Error ? err.message : String(err));
    });

    return id;
  }

  private wireSession(entry: ActiveEntry): void {
    const { info, session } = entry;

    const onChunk = (chunk: string) => {
      if (info.output.length < MAX_STREAM_OUTPUT) info.output += chunk;
      this.emit("output", info.id, chunk);
    };
    const onThinking = (chunk: string) => this.emit("thinking", info.id, chunk);
    const onToolUse = (name: string, toolInput: Record<string, unknown>) => {
      const formatted = formatToolUse(name, toolInput);
      if (info.output.length < MAX_STREAM_OUTPUT) info.output += formatted;
      this.emit("output", info.id, formatted);
      this.emit("tool", info.id, name, toolInput, name);
    };
    const onSessionId = (sessionId: string, model: string) => {
      info.model = model || info.model;
      const key = entry.sessionKey;
      this.lastSessionMap.set(key, sessionId);
      this.lastSessionModelMap.set(key, info.model ?? DEFAULT_MODEL);
      this.pushSessionHistory(info.targetType, info.targetName, sessionId);
      if (!sessionNamesManager.getName(sessionId)) {
        sessionNamesManager.getNextAutoName(info.username).then((name) => sessionNamesManager.setName(sessionId, name));
      }
    };
    const onPermission = (p: PendingPermission) => this.emit("permission", info.id, p.reqId, p.toolName, p.input);
    const onUsage = (u: UsageInfo) => this.emit("usage", info.id, u.costUsd, u.tokens, u.contextPct);
    const onCompact = (trigger: string) => this.emit("compact", info.id, trigger);
    const onCheckpoint = (uuid: string) => this.emit("checkpoint", info.id, uuid);
    const onMode = (mode: PermissionMode) => this.emit("mode", info.id, mode);
    const onSlash = (commands: string[]) => this.emit("slash-commands", info.id, commands);
    const onMcp = (servers: { name: string; status: string }[]) => this.emit("mcp-status", info.id, servers);

    session.on("chunk", onChunk);
    session.on("thinking", onThinking);
    session.on("toolUse", onToolUse);
    session.on("sessionId", onSessionId);
    session.on("permission", onPermission);
    session.on("usage", onUsage);
    session.on("compact", onCompact);
    session.on("checkpoint", onCheckpoint);
    session.on("mode", onMode);
    session.on("slashCommands", onSlash);
    session.on("mcpStatus", onMcp);

    entry.detach = () => {
      session.off("chunk", onChunk);
      session.off("thinking", onThinking);
      session.off("toolUse", onToolUse);
      session.off("sessionId", onSessionId);
      session.off("permission", onPermission);
      session.off("usage", onUsage);
      session.off("compact", onCompact);
      session.off("checkpoint", onCheckpoint);
      session.off("mode", onMode);
      session.off("slashCommands", onSlash);
      session.off("mcpStatus", onMcp);
    };
  }

  private handleResult(entry: ActiveEntry, result: AgentResult): void {
    const { info, opts } = entry;
    if (info.status === "cancelled") return;

    const resumeId = info.resumeSessionId ?? undefined;

    if (result.isError && resumeId) {
      const isSessionNotFound = result.errorMessages.some(
        (m) => m.includes("No conversation found") || m.includes("not a UUID") || m.includes("no rollout found") || m.includes("session not found"),
      );
      if (isSessionNotFound) {
        console.log(`[execution] Resume session ${resumeId} not found for ${opts.targetType}:${opts.targetName}, retrying without resume`);
        const key = entry.sessionKey;
        this.lastSessionMap.delete(key);
        this.lastSessionModelMap.delete(key);
        this.dropSession(key);
        this.finalize(entry);

        info.status = "error";
        info.completedAt = new Date();
        info.error = "Session not found, retrying...";
        info.result = result;
        this.emit("error", info.id, info, info.error);

        this.startExecution({ ...opts, resumeSessionId: null, noResume: true });
        return;
      }
    }

    if (result.isError) {
      info.status = "error";
      info.completedAt = new Date();
      info.error = result.errorMessages.join("; ") || result.output || "Unknown error";
      info.result = result;
      this.finalize(entry);
      this.emit("error", info.id, info, info.error);
      appendHistory(buildHistoryEntry(info, { costUsd: result.costUsd, totalTokens: result.totalTokens, durationMs: result.durationMs }));
      this.routeAgentMessages(opts);
      return;
    }

    info.completedAt = new Date();
    info.result = result;
    if (!info.output) info.output = result.output;

    if (result.sessionId) {
      const key = entry.sessionKey;
      this.lastSessionMap.set(key, result.sessionId);
      this.lastSessionModelMap.set(key, info.model ?? DEFAULT_MODEL);
      this.pushSessionHistory(opts.targetType, opts.targetName, result.sessionId);
      if (!sessionNamesManager.getName(result.sessionId)) {
        sessionNamesManager.getNextAutoName(opts.username).then((name) => sessionNamesManager.setName(result.sessionId, name));
      }
    }

    const askDenial = result.permissionDenials.find((d) => d.tool_name === "AskUserQuestion");

    if (askDenial) {
      info.status = "completed";
      info.pendingQuestion = { toolUseId: askDenial.tool_use_id, questions: askDenial.tool_input.questions };
      this.finalize(entry);
      this.pendingQuestions.set(info.id, { info, opts });
      this.emit("complete", info.id, info);
      this.emit("question", info.id, info);
    } else {
      info.status = "completed";
      info.pendingQuestion = null;
      this.finalize(entry);
      this.emit("complete", info.id, info);
    }

    appendHistory(buildHistoryEntry(info, { costUsd: result.costUsd, totalTokens: result.totalTokens, durationMs: result.durationMs }));
    this.routeAgentMessages(opts);
  }

  private handleFailure(entry: ActiveEntry, message: string): void {
    const { info, opts } = entry;
    if (info.status === "cancelled") return;

    const resumeId = info.resumeSessionId ?? undefined;
    if (resumeId && (message.includes("No conversation found") || message.includes("not a UUID") || message.includes("no rollout found"))) {
      console.log(`[execution] Resume session ${resumeId} not found for ${opts.targetType}:${opts.targetName}, retrying without resume`);
      const key = entry.sessionKey;
      this.lastSessionMap.delete(key);
      this.lastSessionModelMap.delete(key);
      this.dropSession(key);
      this.finalize(entry);

      info.status = "error";
      info.completedAt = new Date();
      info.error = "Session not found, retrying...";
      this.emit("error", info.id, info, info.error);

      this.startExecution({ ...opts, resumeSessionId: null, noResume: true });
      return;
    }

    info.status = "error";
    info.completedAt = new Date();
    info.error = message;
    const durationMs = info.completedAt.getTime() - info.startedAt.getTime();
    info.result = {
      output: info.output,
      sessionId: resumeId ?? "",
      durationMs,
      costUsd: 0,
      totalTokens: 0,
      isError: true,
      errorMessages: [message],
      permissionDenials: [],
    };
    this.finalize(entry);
    this.emit("error", info.id, info, message);
    appendHistory(buildHistoryEntry(info, { durationMs }));
    this.routeAgentMessages(opts);
  }

  sendMessage(id: string, blocksOrText: string | MessageBlock[]): boolean {
    const entry = this.active.get(id);
    if (!entry) return false;
    entry.session.sendUserMessage(blocksOrText);
    return true;
  }

  async interrupt(id: string): Promise<boolean> {
    const entry = this.active.get(id);
    if (!entry) return false;
    await entry.session.interrupt();
    return true;
  }

  async setPermissionMode(id: string, mode: PermissionMode): Promise<boolean> {
    const entry = this.active.get(id);
    if (!entry) return false;
    await entry.session.setPermissionMode(mode);
    return true;
  }

  async setThinking(id: string, level: ThinkingLevel): Promise<boolean> {
    const entry = this.active.get(id);
    if (!entry) return false;
    await entry.session.setThinking(level);
    return true;
  }

  respondPermission(id: string, reqId: string, decision: PermissionDecision): boolean {
    const entry = this.active.get(id);
    if (!entry) return false;
    return entry.session.respondPermission(reqId, decision);
  }

  async rewind(id: string, uuid: string): Promise<boolean> {
    const entry = this.active.get(id);
    if (!entry) return false;
    await entry.session.rewind(uuid);
    this.emit("checkpoint", id, uuid);
    return true;
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

    return this.startExecution({ ...opts, prompt: answer, blocks: undefined, resumeSessionId: sessionId });
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

      const sessionId = entry.session.getSessionId()
        || entry.opts.resumeSessionId
        || this.getLastSessionId(entry.opts.targetType, entry.opts.targetName, entry.opts.username)
        || "";
      if (sessionId) {
        const durationMs = entry.info.completedAt.getTime() - entry.info.startedAt.getTime();
        entry.info.result = {
          output: entry.info.output,
          sessionId,
          durationMs,
          costUsd: 0,
          totalTokens: 0,
          isError: false,
          errorMessages: [],
          permissionDenials: [],
        };
        const key = entry.sessionKey;
        this.lastSessionMap.set(key, sessionId);
        this.lastSessionModelMap.set(key, entry.info.model ?? DEFAULT_MODEL);
        this.pushSessionHistory(entry.opts.targetType, entry.opts.targetName, sessionId);
      }

      entry.session.interrupt().catch(() => {});
      this.finalize(entry);
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

  async loadRecent(): Promise<void> {
    await this.restoreLastSessions();
    const entries = await loadHistory(MAX_RECENT);
    this.recent = entries.map((e) => ({
      id: e.id,
      source: (e.source as ExecutionSource) || "telegram",
      targetType: (e.targetType as ExecutionTargetType) || "orchestrator",
      targetName: e.targetName || "orchestrator",
      agentName: e.agentName,
      model: e.model,
      prompt: e.prompt,
      cwd: "",
      status: (e.status as ExecutionStatus) || "completed",
      startedAt: new Date(e.startedAt),
      completedAt: e.completedAt ? new Date(e.completedAt) : null,
      output: e.output ?? "",
      result: e.costUsd || e.totalTokens || e.durationMs ? {
        output: e.output ?? "",
        sessionId: e.sessionId ?? "",
        durationMs: e.durationMs,
        costUsd: e.costUsd,
        totalTokens: e.totalTokens,
        isError: e.status === "error",
        errorMessages: [],
        permissionDenials: [],
      } : null,
      error: e.error ?? null,
      pendingQuestion: null,
      planMode: e.planMode ?? false,
      username: e.username,
    }));

    for (const e of entries) {
      if (e.sessionId && e.status === "completed") {
        this.pushSessionHistory(e.targetType, e.targetName, e.sessionId);
      }
    }
  }

  private finalize(entry: ActiveEntry): void {
    if (!this.active.has(entry.info.id)) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.active.delete(entry.info.id);
    entry.detach?.();
    if (entry.info.output.length > MAX_MEMORY_OUTPUT) {
      entry.info.output = entry.info.output.slice(0, MAX_MEMORY_OUTPUT) + "\n...(truncated)";
    }
    this.recent.push(entry.info);
    if (this.recent.length > MAX_RECENT) this.recent.shift();
  }

  private routeAgentMessages(opts: StartExecutionOpts): void {
    if (opts.targetType === "agent") {
      if (opts.isInboxProcessing) {
        archiveInboxMessages(opts.targetName);
      }
      const agentRoute = routeMessages(opts.targetName);
      this.triggerInboxProcessing(agentRoute.destinations);
      this.triggerInboxProcessing([opts.targetName]);
    } else if (opts.targetType === "orchestrator") {
      const orchRoute = routeOrchestratorMessages();
      this.triggerInboxProcessing(orchRoute.destinations);
    }
  }

  processInbox(agentName: string): void {
    this.triggerInboxProcessing([agentName]);
  }

  processAllPendingInboxes(): void {
    const agents = listAgents();
    const withMessages = agents.filter((name) => getInboxMessages(name).length > 0);
    if (withMessages.length > 0) {
      console.log(`[inbox] Startup: found pending messages for ${withMessages.join(", ")}`);
      this.triggerInboxProcessing(withMessages);
    }
  }

  private getAnyLastSessionId(targetType: string, targetName: string): string | undefined {
    const prefix = `${targetType}:${targetName}:`;
    for (const [key, sessionId] of this.lastSessionMap) {
      if (key.startsWith(prefix)) return sessionId;
    }
    return undefined;
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

      const resumeSessionId = this.getAnyLastSessionId("agent", agentName);
      console.log(`[inbox] Triggering ${agentName} to process inbox messages${resumeSessionId ? ` (session ${resumeSessionId.slice(0, 8)})` : ""}`);
      this.startExecution({
        source: "web",
        targetType: "agent",
        targetName: agentName,
        prompt: inboxPrompt,
        cwd: paths.root,
        isInboxProcessing: true,
        resumeSessionId,
        username: "system",
      });
    }
  }
}

export const executionManager = new ExecutionManager();
