import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { query, type Query, type SDKMessage, type SDKUserMessage, type PermissionMode, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AgentResult, AskQuestion, PermissionDenial } from "../providers/types.js";
import { ingestTurn, type MemoryTarget } from "../memory/session-memory.js";
import { buildOptions, THINKING_TOKENS, type BuildOptionsParams, type ThinkingLevel } from "./options.js";

export type PermissionDecision = "allow" | "always" | "deny";

export interface MessageBlock {
  type: "text" | "image";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
}

export interface PendingPermission {
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface UsageInfo {
  costUsd: number;
  tokens: number;
  contextPct: number;
}

export interface ClaudeSessionInit extends Omit<BuildOptionsParams, "canUseTool" | "abortController"> {
  permissionTimeoutMs?: number;
}

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

function blocksToText(blocksOrText: string | MessageBlock[]): string {
  if (typeof blocksOrText === "string") return blocksOrText;
  return blocksOrText.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Update"]);

export class ClaudeSession extends EventEmitter {
  readonly target: MemoryTarget;
  readonly planMode: boolean;
  readonly agentName?: string;
  readonly schedulerMode: boolean;
  private queue = createPushableQueue();
  private abortController = new AbortController();
  private runner: Query | null = null;
  private permissionResolvers = new Map<string, { settle: (result: PermissionResult) => void; toolName: string }>();
  private permissionTimeoutMs: number;
  private bypass: boolean;
  private currentPermissionMode: PermissionMode;
  private sessionId = "";
  private model = "";
  private assistantBuffer = "";
  private pendingUserText: string | null = null;
  private result: AgentResult | null = null;
  private settled = false;
  private dead = false;

  constructor(init: ClaudeSessionInit) {
    super();
    this.setMaxListeners(50);
    this.target = init.target;
    this.planMode = Boolean(init.planMode);
    this.agentName = init.agentName;
    this.schedulerMode = Boolean(init.schedulerMode);
    this.permissionTimeoutMs = init.permissionTimeoutMs ?? 0;
    this.bypass = Boolean(init.bypassPermissions);
    this.currentPermissionMode = init.planMode ? "plan" : init.permissionMode ?? (this.bypass ? "bypassPermissions" : "default");

    const options = buildOptions({
      ...init,
      abortController: this.abortController,
      canUseTool: (toolName, input) => this.handlePermission(toolName, input),
      stderr: init.stderr ?? ((data: string) => this.emit("stderr", data)),
    });

    this.runner = query({ prompt: this.queue.iterable, options });
    void this.consume(this.runner);
  }

  private autoApproves(toolName: string): boolean {
    if (this.bypass || this.currentPermissionMode === "bypassPermissions") return true;
    if (this.currentPermissionMode === "acceptEdits") return EDIT_TOOLS.has(toolName);
    return false;
  }

  private handlePermission(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    if (toolName === "AskUserQuestion") {
      return Promise.resolve({ behavior: "deny", message: "Pergunta encaminhada ao usuário." });
    }
    if (this.autoApproves(toolName)) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    const reqId = `${Date.now()}-${randomUUID()}`;
    return new Promise<PermissionResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (result: PermissionResult) => {
        if (timer) clearTimeout(timer);
        this.permissionResolvers.delete(reqId);
        resolve(result);
      };
      this.permissionResolvers.set(reqId, { settle, toolName });
      this.emit("permission", { reqId, toolName, input } satisfies PendingPermission);

      if (this.permissionTimeoutMs > 0) {
        timer = setTimeout(() => {
          settle({ behavior: "deny", message: "Tempo de aprovação esgotado." });
        }, this.permissionTimeoutMs);
      }
    });
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
      if (!this.settled) this.failTurn("Sessão encerrada sem resultado.");
    } catch (err) {
      this.dead = true;
      if (!this.settled) this.failTurn(err instanceof Error ? err.message : String(err));
    }
  }

  private failTurn(message: string): void {
    this.settleResult({
      output: this.assistantBuffer,
      sessionId: this.sessionId,
      durationMs: 0,
      costUsd: 0,
      totalTokens: 0,
      isError: true,
      errorMessages: [message],
      permissionDenials: [],
    });
    this.emit("failure", message);
  }

  isAlive(): boolean {
    return !this.dead;
  }

  private handleMessage(message: SDKMessage): void {
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
      this.currentPermissionMode = message.permissionMode;
      this.emit("sessionId", message.session_id, message.model);
      this.emit("slashCommands", message.slash_commands ?? []);
      this.emit("mcpStatus", message.mcp_servers ?? []);
    } else if (message.subtype === "compact_boundary") {
      this.emit("compact", message.compact_metadata?.trigger ?? "auto");
    } else if (message.subtype === "files_persisted") {
      for (const f of (message as { files?: { file_id: string }[] }).files ?? []) {
        this.emit("checkpoint", f.file_id);
      }
    }
  }

  private handleAssistant(message: Extract<SDKMessage, { type: "assistant" }>): void {
    const content = (message.message as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return;

    for (const raw of content) {
      const block = raw as { type: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown>; id?: string };
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

  private handleResult(message: Extract<SDKMessage, { type: "result" }>): void {
    const usage = message.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);

    let contextPct = 0;
    const modelUsage = Object.values(message.modelUsage ?? {})[0] as { contextWindow?: number; inputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number } | undefined;
    if (modelUsage?.contextWindow) {
      const used = (modelUsage.inputTokens ?? 0) + (modelUsage.cacheReadInputTokens ?? 0) + (modelUsage.cacheCreationInputTokens ?? 0);
      contextPct = Math.min(100, Math.round((used / modelUsage.contextWindow) * 100));
    }

    this.emit("usage", { costUsd: message.total_cost_usd ?? 0, tokens: totalTokens, contextPct } satisfies UsageInfo);

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

    if (this.pendingUserText) {
      ingestTurn(this.target, result.sessionId, "user", this.pendingUserText);
      this.pendingUserText = null;
    }
    if (result.output.trim()) {
      ingestTurn(this.target, result.sessionId, "assistant", result.output, { model: this.model });
    }

    this.settleResult(result);
  }

  private settleResult(result: AgentResult): void {
    this.result = result;
    this.settled = true;
    this.assistantBuffer = "";
    this.emit("result", result);
  }

  sendUserMessage(blocksOrText: string | MessageBlock[], ingestText?: string): void {
    const stored = (ingestText ?? blocksToText(blocksOrText)).trim();
    this.pendingUserText = stored ? stored : null;
    this.settled = false;

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

  async setThinking(level: ThinkingLevel): Promise<void> {
    try {
      await this.runner?.setMaxThinkingTokens(THINKING_TOKENS[level]);
    } catch {}
  }

  async rewind(uuid: string): Promise<void> {
    try {
      await (this.runner as unknown as { rewindFiles?: (u: string) => Promise<void> })?.rewindFiles?.(uuid);
    } catch {}
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getModel(): string {
    return this.model;
  }

  getLastResult(): AgentResult | null {
    return this.result;
  }

  waitForResult(): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve) => {
      const onResult = (r: AgentResult) => {
        this.off("failure", onError);
        resolve(r);
      };
      const onError = () => {
        this.off("result", onResult);
        resolve(this.result ?? {
          output: "",
          sessionId: this.sessionId,
          durationMs: 0,
          costUsd: 0,
          totalTokens: 0,
          isError: true,
          errorMessages: ["Sessão encerrada com erro."],
          permissionDenials: [],
        });
      };
      this.once("result", onResult);
      this.once("failure", onError);
    });
  }

  end(): void {
    for (const { settle } of this.permissionResolvers.values()) {
      settle({ behavior: "deny", message: "Sessão encerrada." });
    }
    this.permissionResolvers.clear();
    this.queue.end();
    this.abortController.abort();
  }
}
