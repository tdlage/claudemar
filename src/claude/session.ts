import { randomUUID } from "node:crypto";
import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AgentResult, AskQuestion, PermissionDenial } from "../providers/types.js";
import { buildOptions, effortToFlagLevel, isUltracode } from "./options.js";
import { decideImmediatePermission } from "./permission.js";
import { resolveInitialPermissionMode } from "../runtime/permission-mode.js";
import { BaseAgentSession, DEFAULT_CONTEXT_WINDOW, blocksToText, contextPercent } from "../runtime/base-session.js";
import type { AgentSessionInit, Effort, MessageBlock, PendingPermission, PermissionDecision, TaskEvent, UsageInfo } from "../runtime/types.js";

interface PushableQueue {
  iterable: AsyncIterable<SDKUserMessage>;
  push: (msg: SDKUserMessage) => void;
  end: () => void;
}

function createPushableQueue(): PushableQueue {
  const buffer: SDKUserMessage[] = [];
  let resolveNext: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  let done = false;

  const iterator: AsyncIterator<SDKUserMessage> = {
    next(): Promise<IteratorResult<SDKUserMessage>> {
      if (buffer.length > 0) {
        return Promise.resolve({ value: buffer.shift()!, done: false });
      }
      if (done) {
        return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
      }
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    },
    return(): Promise<IteratorResult<SDKUserMessage>> {
      done = true;
      return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
    },
  };

  return {
    iterable: { [Symbol.asyncIterator]: () => iterator },
    push(msg) {
      if (done) return;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: msg, done: false });
      } else {
        buffer.push(msg);
      }
    },
    end() {
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined as unknown as SDKUserMessage, done: true });
      }
    },
  };
}

export class ClaudeSession extends BaseAgentSession {
  private queue = createPushableQueue();
  private abortController = new AbortController();
  private runner: Query | null = null;
  private permissionResolvers = new Map<string, { settle: (result: PermissionResult) => void; toolName: string; input: Record<string, unknown> }>();
  private permissionTimeoutMs: number;
  private bypass: boolean;
  private currentPermissionMode: PermissionMode;
  private activeTasks = new Map<string, { description: string; subagentType?: string }>();
  private pendingResult: AgentResult | null = null;
  private pendingTasksGraceMs: number;
  private pendingTasksTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(init: AgentSessionInit) {
    super(init);
    this.permissionTimeoutMs = init.permissionTimeoutMs ?? 0;
    this.bypass = Boolean(init.bypassPermissions);
    this.currentPermissionMode = resolveInitialPermissionMode(init);
    this.pendingTasksGraceMs = init.pendingTasksGraceMs ?? 0;

    const options = buildOptions({
      ...init,
      abortController: this.abortController,
      canUseTool: (toolName, input) => this.handlePermission(toolName, input),
      stderr: init.stderr ?? ((data: string) => this.emit("stderr", data)),
    });

    this.runner = query({ prompt: this.queue.iterable, options });
    void this.consume(this.runner);
    this.startInactivityTimer();
  }

  protected onInactivity(): void {
    this.abortController.abort();
    this.queue.end();
    if (!this.settled) {
      this.drainPendingResult("Sessão inativa por muito tempo — possível limite de sessão ou travamento do runner.");
    }
  }

  // Com o resultado do turno retido aguardando subagentes em background, subagentes podem
  // morrer sem nunca emitir task_notification (ex.: falha de spawn em provider third-party).
  // Sem este grace timer a execução ficaria "running" até o watchdog de inatividade.
  private startPendingTasksTimer(): void {
    if (this.pendingTasksGraceMs <= 0) return;
    this.clearPendingTasksTimer();
    this.pendingTasksTimer = setTimeout(() => {
      if (this.pendingResult) this.drainPendingResult("");
    }, this.pendingTasksGraceMs);
  }

  private clearPendingTasksTimer(): void {
    if (this.pendingTasksTimer) {
      clearTimeout(this.pendingTasksTimer);
      this.pendingTasksTimer = null;
    }
  }

  private flushLostTasks(): void {
    for (const [taskId, task] of this.activeTasks) {
      this.emit("task", {
        phase: "done",
        taskId,
        description: task.description,
        subagentType: task.subagentType,
        status: "failed",
        summary: "Subagente sem resposta — descartado após espera.",
      } satisfies TaskEvent);
    }
    this.activeTasks.clear();
  }

  private handlePermission(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    const immediate = decideImmediatePermission(toolName, input, {
      bypass: this.bypass,
      currentPermissionMode: this.currentPermissionMode,
    });
    if (immediate) return Promise.resolve(immediate);

    const reqId = `${Date.now()}-${randomUUID()}`;
    return new Promise<PermissionResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (result: PermissionResult) => {
        if (timer) clearTimeout(timer);
        this.permissionResolvers.delete(reqId);
        this.emit("permissionResolved", reqId);
        resolve(result);
      };
      this.permissionResolvers.set(reqId, { settle, toolName, input });
      this.emit("permission", { reqId, toolName, input } satisfies PendingPermission);

      if (this.permissionTimeoutMs > 0) {
        timer = setTimeout(() => {
          settle({ behavior: "deny", message: "Tempo de aprovação esgotado." });
        }, this.permissionTimeoutMs);
      }
    });
  }

  getPendingPermissions(): PendingPermission[] {
    return [...this.permissionResolvers.entries()].map(([reqId, e]) => ({ reqId, toolName: e.toolName, input: e.input }));
  }

  respondPermission(reqId: string, decision: PermissionDecision): boolean {
    const entry = this.permissionResolvers.get(reqId);
    if (!entry) return false;
    if (decision === "deny") {
      entry.settle({ behavior: "deny", message: "Negado pelo usuário." });
    } else if (decision === "always") {
      const updatedPermissions = [{
        type: "addRules",
        rules: [{ toolName: entry.toolName }],
        behavior: "allow",
        destination: "session",
      }] as never;
      entry.settle({ behavior: "allow", updatedPermissions });
    } else {
      entry.settle({ behavior: "allow" });
    }
    return true;
  }

  private async consume(runner: Query): Promise<void> {
    try {
      for await (const message of runner) {
        this.handleMessage(message);
      }
      this.dead = true;
      if (!this.settled) this.drainPendingResult("Sessão encerrada sem resultado.");
    } catch (err) {
      this.dead = true;
      if (!this.settled) this.drainPendingResult(err instanceof Error ? err.message : String(err));
    }
  }

  // O stream terminou (fim natural, abort/timeout ou erro) antes de assentar. Se o turno
  // principal já produziu um resultado que ficou retido aguardando subagentes em background,
  // usa esse resultado; caso contrário, encerra o turno como falha.
  private drainPendingResult(fallbackMessage: string): void {
    if (this.pendingResult) {
      const result = this.pendingResult;
      this.pendingResult = null;
      this.flushLostTasks();
      this.settleTurn(result);
    } else {
      this.clearPendingTasksTimer();
      this.activeTasks.clear();
      this.pendingResult = null;
      this.failTurn(fallbackMessage);
    }
  }

  private settleTurn(result: AgentResult): void {
    this.clearPendingTasksTimer();
    this.activeTasks.clear();
    this.pendingResult = null;
    this.settleResult(result);
  }

  private handleMessage(message: SDKMessage): void {
    this.resetInactivityTimer();
    switch (message.type) {
      case "system":
        this.handleSystem(message);
        break;
      case "assistant":
        this.handleAssistant(message);
        break;
      case "result":
        this.handleResult(message);
        break;
      default:
        break;
    }
  }

  private handleSystem(message: Extract<SDKMessage, { type: "system" }>): void {
    if (message.subtype === "init") {
      this.sessionId = message.session_id;
      this.model = message.model;
      this.currentPermissionMode = this.bypass ? "bypassPermissions" : message.permissionMode;
      this.emit("sessionId", message.session_id, message.model);
      this.emit("slashCommands", message.slash_commands ?? []);
      this.emit("mcpStatus", message.mcp_servers ?? []);
    } else if (message.subtype === "compact_boundary") {
      this.emit("compact", message.compact_metadata?.trigger ?? "auto");
    } else if (message.subtype === "files_persisted") {
      for (const f of (message as { files?: { file_id: string }[] }).files ?? []) {
        this.emit("checkpoint", f.file_id);
      }
    } else if (message.subtype === "task_started") {
      this.touchPendingTasks();
      this.handleTaskStarted(message);
    } else if (message.subtype === "task_progress") {
      this.touchPendingTasks();
      this.handleTaskProgress(message);
    } else if (message.subtype === "task_updated") {
      this.touchPendingTasks();
      this.handleTaskUpdated(message);
    } else if (message.subtype === "task_notification") {
      this.touchPendingTasks();
      this.handleTaskNotification(message);
    }
  }

  private touchPendingTasks(): void {
    if (this.pendingResult) this.startPendingTasksTimer();
  }

  private handleTaskStarted(message: Extract<SDKMessage, { subtype: "task_started" }>): void {
    if (message.skip_transcript) return;
    this.activeTasks.set(message.task_id, { description: message.description, subagentType: message.subagent_type });
    this.emit("task", {
      phase: "started",
      taskId: message.task_id,
      description: message.description,
      subagentType: message.subagent_type,
      taskType: message.task_type,
      workflowName: message.workflow_name,
      status: "running",
    } satisfies TaskEvent);
  }

  private handleTaskProgress(message: Extract<SDKMessage, { subtype: "task_progress" }>): void {
    if (!this.activeTasks.has(message.task_id)) return;
    this.emit("task", {
      phase: "progress",
      taskId: message.task_id,
      description: message.description,
      subagentType: message.subagent_type,
      tokens: message.usage.total_tokens,
      toolUses: message.usage.tool_uses,
      durationMs: message.usage.duration_ms,
      lastToolName: message.last_tool_name,
      summary: message.summary,
      status: "running",
    } satisfies TaskEvent);
  }

  private handleTaskUpdated(message: Extract<SDKMessage, { subtype: "task_updated" }>): void {
    const status = message.patch.status;
    this.emit("task", {
      phase: "updated",
      taskId: message.task_id,
      description: message.patch.description,
      status: status === "pending" || status === "paused" ? "running" : status,
      error: message.patch.error,
    } satisfies TaskEvent);
    if (status === "completed" || status === "failed" || status === "killed") {
      this.finishTask(message.task_id);
    }
  }

  private handleTaskNotification(message: Extract<SDKMessage, { subtype: "task_notification" }>): void {
    this.emit("task", {
      phase: "done",
      taskId: message.task_id,
      status: message.status,
      summary: message.summary,
      tokens: message.usage?.total_tokens,
      toolUses: message.usage?.tool_uses,
      durationMs: message.usage?.duration_ms,
    } satisfies TaskEvent);
    this.finishTask(message.task_id);
  }

  private finishTask(taskId: string): void {
    if (!this.activeTasks.delete(taskId)) return;
    this.maybeSettlePending();
  }

  // Só assenta o resultado do turno principal depois que todos os subagentes em background
  // terminarem — o SDK emite o "result" do turno enquanto os finders ainda rodam.
  private maybeSettlePending(): void {
    if (this.pendingResult && this.activeTasks.size === 0) {
      const result = this.pendingResult;
      this.pendingResult = null;
      this.settleTurn(result);
    }
  }

  private handleAssistant(message: Extract<SDKMessage, { type: "assistant" }>): void {
    const content = (message.message as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return;

    for (const raw of content) {
      const block = raw as { type: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown> };
      if (block.type === "text" && block.text) {
        this.assistantBuffer += block.text;
        this.emit("chunk", block.text);
      } else if (block.type === "thinking" && block.thinking) {
        this.emit("thinking", block.thinking);
      } else if (block.type === "tool_use" && block.name) {
        this.emit("toolUse", block.name, block.input ?? {});
      }
    }
  }

  private async emitUsage(costUsd: number, tokens: number, contextTokens = 0): Promise<void> {
    let contextPct = 0;
    try {
      const ctx = await this.runner?.getContextUsage();
      const max = ctx?.maxTokens || ctx?.rawMaxTokens || DEFAULT_CONTEXT_WINDOW;
      contextPct = contextPercent(ctx?.totalTokens || contextTokens, max);
    } catch {
      contextPct = contextPercent(contextTokens, DEFAULT_CONTEXT_WINDOW);
    }
    this.emit("usage", { costUsd, tokens, contextPct } satisfies UsageInfo);
  }

  private handleResult(message: Extract<SDKMessage, { type: "result" }>): void {
    const usage = message.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
    const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    // Tokens "em contexto" no fim do turno ≈ tamanho do contexto usado (entrada + cache).
    const contextTokens = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);

    void this.emitUsage(message.total_cost_usd ?? 0, totalTokens, contextTokens);

    const denials: PermissionDenial[] = [];
    for (const d of message.permission_denials ?? []) {
      if (d.tool_name === "AskUserQuestion") {
        const input = d.tool_input as { questions?: AskQuestion[] };
        if (input?.questions) {
          denials.push({ tool_name: d.tool_name, tool_use_id: d.tool_use_id, tool_input: { questions: input.questions } });
        }
      }
    }

    const isError = message.subtype !== "success";
    const output = message.subtype === "success" ? message.result : this.assistantBuffer;
    const errorMessages = message.subtype !== "success" ? message.errors ?? [message.subtype] : [];

    const result: AgentResult = {
      output: output || this.assistantBuffer,
      sessionId: message.session_id || this.sessionId,
      durationMs: message.duration_ms ?? 0,
      costUsd: message.total_cost_usd ?? 0,
      totalTokens,
      isError,
      errorMessages,
      permissionDenials: denials,
    };

    this.ingestResult(result);

    // Se há subagentes rodando em background, retém o resultado até que todos terminem
    // (via task_notification) para não marcar a execução como concluída cedo demais.
    if (this.activeTasks.size > 0) {
      this.pendingResult = result;
      this.emit("tasksPending", this.activeTasks.size);
      this.startPendingTasksTimer();
    } else {
      this.settleTurn(result);
    }
  }

  sendUserMessage(blocksOrText: string | MessageBlock[], ingestText?: string): void {
    const stored = (ingestText ?? blocksToText(blocksOrText)).trim();
    this.pendingUserText = stored ? stored : null;
    this.settled = false;
    this.activeTasks.clear();
    this.pendingResult = null;
    this.clearPendingTasksTimer();
    this.startInactivityTimer();
    let content: SDKUserMessage["message"]["content"];
    if (typeof blocksOrText === "string") {
      content = blocksOrText;
    } else {
      content = blocksOrText.map((b) =>
        b.type === "image" && b.source
          ? { type: "image" as const, source: b.source }
          : { type: "text" as const, text: b.text ?? "" },
      ) as SDKUserMessage["message"]["content"];
    }

    const message: SDKUserMessage = {
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content },
    };
    this.queue.push(message);
  }

  async interrupt(): Promise<void> {
    try {
      await this.runner?.interrupt();
    } catch {
      this.abortController.abort();
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.currentPermissionMode = mode;
    this.bypass = mode === "bypassPermissions";
    if (this.bypass) {
      for (const { settle } of this.permissionResolvers.values()) {
        settle({ behavior: "allow" });
      }
      this.permissionResolvers.clear();
    }
    try {
      await this.runner?.setPermissionMode(mode);
    } catch {}
    this.emit("mode", mode);
  }

  async setModel(id?: string): Promise<void> {
    try {
      await this.runner?.setModel(id);
    } catch {}
  }

  async setEffort(effort: Effort): Promise<void> {
    try {
      if (isUltracode(effort)) {
        await this.runner?.applyFlagSettings({ enableWorkflows: true, ultracode: true, effortLevel: "xhigh" });
      } else {
        await this.runner?.applyFlagSettings({ ultracode: false, effortLevel: effortToFlagLevel(effort) });
      }
    } catch {}
  }

  async rewind(uuid: string): Promise<void> {
    try {
      await (this.runner as unknown as { rewindFiles?: (u: string) => Promise<void> })?.rewindFiles?.(uuid);
    } catch {}
  }

  getPermissionMode(): PermissionMode {
    return this.currentPermissionMode;
  }

  end(): void {
    this.clearInactivityTimer();
    this.clearPendingTasksTimer();
    for (const { settle } of this.permissionResolvers.values()) {
      settle({ behavior: "deny", message: "Sessão encerrada." });
    }
    this.permissionResolvers.clear();
    this.activeTasks.clear();
    this.pendingResult = null;
    this.queue.end();
    this.abortController.abort();
  }
}
