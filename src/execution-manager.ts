import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AgentDefinition, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AgentResult, AskQuestion } from "./providers/types.js";
import { ClaudeSession, type MessageBlock, type PendingPermission, type PermissionDecision, type UsageInfo } from "./claude/session.js";
import { isUltracode, type Effort } from "./claude/options.js";
import { formatToolUse } from "./providers/format.js";
import { type HistoryEntry, appendHistory, loadHistory } from "./history.js";
import { buildAgentDefinitions } from "./agents/subagents.js";
import { teammatesOf, squadMcpsForAgent, squadSkillsForAgent } from "./agents/teams-manager.js";
import { buildEmailHint, buildSecretsHint } from "./agents/agent-context.js";
import { config } from "./config.js";
import { sessionNamesManager } from "./session-names-manager.js";
import { query } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

export type ExecutionSource = "telegram" | "web" | "schedule";
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
  rawPrompt?: string;
  cwd: string;
  resumeSessionId?: string | null;
  noResume?: boolean;
  timeoutMs?: number;
  model?: string;
  planMode?: boolean;
  agentName?: string;
  username?: string;
  skipSystemPrompt?: boolean;
  blocks?: MessageBlock[];
  effort?: Effort;
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
  schedulerMode?: boolean;
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
  private sessionGen = new Map<string, number>();
  private llmConfigGen = 0;

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
      suffix += `\n[SYSTEM: Before executing, read your AGENTS.md for your role and instructions. To delegate a task to another agent, invoke it as a subagent via the Agent tool (the available agents are exposed automatically).]`;
    }
    if (opts.targetType === "agent") {
      suffix += buildSecretsHint(opts.targetName);
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
    if (opts.targetType === "agent" || opts.targetType === "orchestrator") {
      suffix += buildEmailHint();
    }
    if (opts.schedulerMode && opts.targetType === "agent") {
      suffix += `\n[SYSTEM: MODO AGENDAMENTO ATIVO. Quando o usuário pedir uma tarefa recorrente ou para rodar em determinado horário, NÃO edite crontab nem arquivos manualmente: use a tool mcp__scheduler__schedule_task (passe a expressão cron, uma descrição legível do horário, o que a tarefa faz e o prompt completo a ser executado). Use mcp__scheduler__list_schedules e mcp__scheduler__remove_schedule para consultar/remover. Sempre confirme ao usuário o que foi agendado.]`;
    }
    return suffix;
  }

  private buildSubagents(opts: StartExecutionOpts): Record<string, AgentDefinition> | undefined {
    if (opts.targetType === "orchestrator") return buildAgentDefinitions();
    if (opts.targetType === "agent") return buildAgentDefinitions(opts.targetName, teammatesOf(opts.targetName));
    return undefined;
  }

  private getOrCreateSession(opts: StartExecutionOpts, sessionKey: string, resumeId: string | undefined): { session: ClaudeSession; isNew: boolean } {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      const planChanged = Boolean(opts.planMode) !== existing.planMode;
      const agentChanged = (opts.agentName ?? "") !== (existing.agentName ?? "");
      const schedulerChanged = Boolean(opts.schedulerMode) !== existing.schedulerMode;
      const resumeChanged = Boolean(resumeId) && resumeId !== existing.getSessionId();
      const llmChanged = this.sessionGen.get(sessionKey) !== this.llmConfigGen;
      if (existing.isAlive() && !planChanged && !agentChanged && !schedulerChanged && !resumeChanged && !llmChanged) {
        return { session: existing, isNew: false };
      }
      existing.end();
      this.sessions.delete(sessionKey);
    }

    const interactive = opts.source === "web" && !opts.autoApprove;
    const bypass = opts.autoApprove || opts.permissionMode === "bypassPermissions" || (!opts.planMode && !interactive);
    const session = new ClaudeSession({
      cwd: opts.cwd,
      target: { targetType: opts.targetType, targetName: opts.targetName },
      agentName: opts.agentName,
      planMode: opts.planMode,
      permissionMode: opts.permissionMode,
      bypassPermissions: bypass,
      resumeSessionId: resumeId ?? null,
      effort: opts.effort,
      systemAppend: this.buildSystemSuffix(opts),
      subagents: this.buildSubagents(opts),
      isSubagentAllowed: opts.targetType === "agent"
        ? (name: string) => teammatesOf(opts.targetName).includes(name)
        : undefined,
      extraMcpServers: opts.targetType === "agent" ? squadMcpsForAgent(opts.targetName) : undefined,
      squadSkills: opts.targetType === "agent" ? squadSkillsForAgent(opts.targetName) : undefined,
      schedulerMode: opts.schedulerMode,
      permissionTimeoutMs: config.permissionTimeoutMs,
    });
    this.sessions.set(sessionKey, session);
    this.sessionGen.set(sessionKey, this.llmConfigGen);
    return { session, isNew: true };
  }

  private dropSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.end();
      this.sessions.delete(sessionKey);
    }
  }

  invalidateLlmSessions(): void {
    this.llmConfigGen++;
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
      // New sessions get effort from buildOptions (Options.effort), which also
      // covers "max". Ultracode additionally needs its session flags applied,
      // and resumed sessions need any effort change pushed to the live runner.
      if (opts.effort && (!isNew || isUltracode(opts.effort))) {
        await session.setEffort(opts.effort).catch(() => {});
      }

      session.sendUserMessage(opts.blocks ?? opts.prompt, opts.rawPrompt);
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
    const onPermissionResolved = (reqId: string) => this.emit("permission-resolved", info.id, reqId);
    const onSubagentDone = (to: string) => this.emit("subagent-done", info.id, to);
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
    session.on("permissionResolved", onPermissionResolved);
    session.on("subagentDone", onSubagentDone);
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
      session.off("permissionResolved", onPermissionResolved);
      session.off("subagentDone", onSubagentDone);
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

  async setEffort(id: string, effort: Effort): Promise<boolean> {
    const entry = this.active.get(id);
    if (!entry) return false;
    await entry.session.setEffort(effort);
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

  isExecutionActive(id: string): boolean {
    return this.active.has(id);
  }

  getPendingPermissions(id: string): PendingPermission[] {
    return this.active.get(id)?.session.getPendingPermissions() ?? [];
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
}

export const executionManager = new ExecutionManager();
