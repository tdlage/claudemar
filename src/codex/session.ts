import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Codex, type ThreadEvent, type ThreadItem, type Usage, type UserInput } from "@openai/codex-sdk";
import type { AgentResult } from "../providers/types.js";
import type { LlmProfile } from "../providers/llm.js";
import { buildSystemAppend } from "../runtime/system-append.js";
import { collectSessionMcpServers } from "../runtime/mcp-servers.js";
import { resolveInitialPermissionMode } from "../runtime/permission-mode.js";
import { BaseAgentSession, DEFAULT_CONTEXT_WINDOW, blocksToText, contextPercent } from "../runtime/base-session.js";
import type { AgentSessionInit, Effort, MessageBlock, PendingPermission, UsageInfo } from "../runtime/types.js";
import { bridgedMcpConfig, buildCodexConfig, buildCodexEnv, buildThreadOptions, splitMcpServers, type CodexConfigObject } from "./options.js";
import { mcpHttpHost } from "./mcp-host.js";
import { noteCodexFailure, noteCodexSuccess } from "./codex-auth-state.js";

export interface ToolUseEvent {
  name: string;
  input: Record<string, unknown>;
}

// Traduz os itens do Codex para os nomes de tool que o restante do sistema já conhece
// (formatação no terminal, classificação de atividade, permissões).
export function toolUsesForItem(item: ThreadItem, phase: "started" | "updated" | "completed"): ToolUseEvent[] {
  switch (item.type) {
    case "command_execution":
      return phase === "started" ? [{ name: "Bash", input: { command: item.command } }] : [];
    case "file_change":
      if (phase !== "completed") return [];
      return item.changes.map((change) => ({
        name: change.kind === "add" ? "Write" : change.kind === "delete" ? "Bash" : "Edit",
        input: change.kind === "delete" ? { command: `rm ${change.path}` } : { file_path: change.path },
      }));
    case "mcp_tool_call": {
      if (phase !== "started") return [];
      const args = item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : { arguments: item.arguments };
      return [{ name: `mcp__${item.server}__${item.tool}`, input: args }];
    }
    case "web_search":
      return phase === "completed" ? [{ name: "WebSearch", input: { query: item.query } }] : [];
    case "todo_list":
      return phase === "started" ? [{ name: "TodoWrite", input: { todos: item.items } }] : [];
    default:
      return [];
  }
}

export function usageTokens(usage: Usage): { total: number; context: number } {
  const input = usage.input_tokens ?? 0;
  const cached = usage.cached_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return { total: input + output, context: input + cached };
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

interface PreparedInput {
  input: string | UserInput[];
  tempDir: string | null;
}

async function prepareInput(blocksOrText: string | MessageBlock[]): Promise<PreparedInput> {
  if (typeof blocksOrText === "string") return { input: blocksOrText, tempDir: null };
  const images = blocksOrText.filter((b) => b.type === "image" && b.source);
  const text = blocksToText(blocksOrText);
  if (images.length === 0) return { input: text, tempDir: null };

  const tempDir = await mkdtemp(resolve(tmpdir(), "claudemar-codex-"));
  const parts: UserInput[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  let index = 0;
  for (const block of images) {
    const source = block.source!;
    const ext = IMAGE_EXTENSIONS[source.media_type] ?? "bin";
    const path = resolve(tempDir, `image-${index++}.${ext}`);
    await writeFile(path, Buffer.from(source.data, "base64"));
    parts.push({ type: "local_image", path });
  }
  return { input: parts, tempDir };
}

// O runtime Codex não expõe subagentes: o orquestrador precisa executar sozinho.
function buildDeveloperInstructions(init: AgentSessionInit): string {
  const base = buildSystemAppend(init);
  if (init.target.targetType !== "orchestrator") return base;
  return `${base}\n\nNeste runtime não existe a tool Agent nem subagentes: não tente delegar a outros agentes, execute a tarefa você mesmo.`;
}

interface TurnHandle {
  abort: AbortController;
  done: boolean;
}

interface TurnOutcome {
  message?: string;
  usage?: Usage;
  failure?: string;
  streamError?: string;
}

interface PendingResult {
  startedAt: number;
  totalTokens: number;
  contextTokens: number;
  output: string;
}

export class CodexSession extends BaseAgentSession {
  private readonly profile: LlmProfile;
  private readonly cwd: string;
  private readonly developerInstructions: string;
  private readonly mcpInstances: Record<string, McpServer>;
  private readonly externalMcp: Record<string, CodexConfigObject>;
  private readonly mcpToken: string;
  private currentPermissionMode: PermissionMode;
  private currentModel: string;
  private effort: Effort;
  private turnChain: Promise<void> = Promise.resolve();
  private currentTurn: TurnHandle | null = null;
  // Mensagens enviadas enquanto um turno roda viram turnos encadeados; o resultado da
  // execução só assenta depois do último deles, como no runtime Claude.
  private queuedTurns = 0;
  private skipTurns = 0;
  private pending: PendingResult | null = null;
  private announced = false;

  constructor(init: AgentSessionInit, profile: LlmProfile) {
    super(init);
    this.profile = profile;
    this.cwd = init.cwd;
    this.currentModel = this.requestedModel;
    this.effort = init.effort ?? "high";
    this.currentPermissionMode = resolveInitialPermissionMode(init);
    this.sessionId = init.resumeSessionId ?? "";
    this.developerInstructions = buildDeveloperInstructions(init);

    const split = splitMcpServers(collectSessionMcpServers(init));
    for (const name of split.skipped) console.warn(`[codex] MCP "${name}" (SSE) não é suportado pelo Codex e foi ignorado.`);
    this.mcpInstances = split.instances;
    this.externalMcp = split.external;
    this.mcpToken = mcpHttpHost.register(this.mcpInstances);
    this.startInactivityTimer();
  }

  protected onInactivity(): void {
    this.abortCurrentTurn();
    if (!this.settled) {
      this.failTurn("Sessão inativa por muito tempo — possível limite de sessão ou travamento do runner.");
    }
  }

  private abortCurrentTurn(): void {
    const turn = this.currentTurn;
    if (!turn) return;
    turn.done = true;
    turn.abort.abort();
    this.skipTurns = this.queuedTurns;
    this.queuedTurns = 0;
    this.pending = null;
  }

  sendUserMessage(blocksOrText: string | MessageBlock[], ingestText?: string): void {
    const stored = (ingestText ?? blocksToText(blocksOrText)).trim();
    if (stored) this.pendingUserText = this.pendingUserText ? `${this.pendingUserText}\n\n${stored}` : stored;
    this.settled = false;
    this.queuedTurns++;
    this.startInactivityTimer();
    this.turnChain = this.turnChain
      .then(() => this.runTurn(blocksOrText))
      .catch((err) => {
        if (!this.settled) this.failTurn(err instanceof Error ? err.message : String(err));
      });
  }

  private async runTurn(blocksOrText: string | MessageBlock[]): Promise<void> {
    if (this.skipTurns > 0) {
      this.skipTurns--;
      return;
    }
    if (this.dead) {
      this.queuedTurns = 0;
      if (!this.settled) this.failTurn("Sessão encerrada.");
      return;
    }
    const turn: TurnHandle = { abort: new AbortController(), done: false };
    this.currentTurn = turn;
    const pending = this.pending ?? { startedAt: Date.now(), totalTokens: 0, contextTokens: 0, output: "" };
    this.pending = pending;
    let usage: Usage | null = null;
    let failure: string | null = null;
    let streamError: string | null = null;
    let tempDir: string | null = null;

    try {
      const prepared = await prepareInput(blocksOrText);
      tempDir = prepared.tempDir;
      const urls = Object.keys(this.mcpInstances).length > 0 ? await mcpHttpHost.bindTurn(this.mcpToken) : {};
      const codex = new Codex({
        env: buildCodexEnv(process.env, this.profile, this.mcpToken),
        config: buildCodexConfig({
          profile: this.profile,
          developerInstructions: this.developerInstructions,
          mcpServers: { ...this.externalMcp, ...bridgedMcpConfig(urls) },
        }),
      });
      const threadOptions = buildThreadOptions({
        model: this.currentModel,
        permissionMode: this.currentPermissionMode,
        effort: this.effort,
        cwd: this.cwd,
      });
      const thread = this.sessionId ? codex.resumeThread(this.sessionId, threadOptions) : codex.startThread(threadOptions);
      const { events } = await thread.runStreamed(prepared.input, { signal: turn.abort.signal });

      for await (const event of events) {
        this.resetInactivityTimer();
        const outcome = this.handleEvent(event);
        if (outcome.message !== undefined) pending.output = outcome.message;
        if (outcome.usage) usage = outcome.usage;
        if (outcome.streamError) streamError = outcome.streamError;
        if (outcome.failure) {
          failure = outcome.failure;
          break;
        }
      }
    } catch (err) {
      if (failure === null) {
        failure = turn.abort.signal.aborted ? "Interrompido pelo usuário." : err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.currentTurn = null;
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    if (turn.done) return;
    turn.done = true;
    this.queuedTurns = Math.max(0, this.queuedTurns - 1);

    if (failure !== null) {
      this.skipTurns = this.queuedTurns;
      this.queuedTurns = 0;
      this.pending = null;
      noteCodexFailure(failure);
      this.failTurn(failure);
      return;
    }
    if (!usage) {
      this.skipTurns = this.queuedTurns;
      this.queuedTurns = 0;
      this.pending = null;
      this.failTurn(streamError ?? "Turno encerrado sem resultado.");
      return;
    }

    const tokens = usageTokens(usage);
    pending.totalTokens += tokens.total;
    pending.contextTokens = tokens.context;
    if (this.queuedTurns > 0) return;

    this.pending = null;
    const window = Number(this.profile.autoCompactWindow.trim()) || DEFAULT_CONTEXT_WINDOW;
    this.emit("usage", { costUsd: 0, tokens: pending.totalTokens, contextPct: contextPercent(pending.contextTokens, window) } satisfies UsageInfo);

    const result: AgentResult = {
      output: pending.output || this.assistantBuffer,
      sessionId: this.sessionId,
      durationMs: Date.now() - pending.startedAt,
      costUsd: 0,
      totalTokens: pending.totalTokens,
      isError: false,
      errorMessages: [],
      permissionDenials: [],
    };
    noteCodexSuccess();
    this.ingestResult(result);
    this.settleResult(result);
  }

  private handleEvent(event: ThreadEvent): TurnOutcome {
    switch (event.type) {
      case "thread.started":
        this.announce(event.thread_id);
        return {};
      case "turn.started":
        return {};
      case "turn.completed":
        return { usage: event.usage };
      case "turn.failed":
        return { failure: event.error.message };
      case "error":
        if (/reconnect/i.test(event.message)) {
          this.emit("stderr", event.message);
          return {};
        }
        return { streamError: event.message };
      case "item.started":
      case "item.updated":
      case "item.completed":
        return this.handleItem(event.item, event.type === "item.started" ? "started" : event.type === "item.updated" ? "updated" : "completed");
      default:
        return {};
    }
  }

  private handleItem(item: ThreadItem, phase: "started" | "updated" | "completed"): TurnOutcome {
    if (item.type === "agent_message") {
      if (phase !== "completed" || !item.text) return {};
      this.assistantBuffer += item.text;
      this.emit("chunk", item.text);
      return { message: item.text };
    }
    if (item.type === "reasoning") {
      if (phase === "completed" && item.text) this.emit("thinking", item.text);
      return {};
    }
    if (item.type === "error") {
      if (phase === "completed") this.emit("stderr", item.message);
      return {};
    }
    for (const tool of toolUsesForItem(item, phase)) this.emit("toolUse", tool.name, tool.input);
    return {};
  }

  private announce(threadId: string): void {
    this.sessionId = threadId;
    this.model = this.currentModel;
    if (this.announced) return;
    this.announced = true;
    this.emit("sessionId", threadId, this.currentModel);
    this.emit("slashCommands", []);
    const names = [...Object.keys(this.mcpInstances), ...Object.keys(this.externalMcp)];
    this.emit("mcpStatus", names.map((name) => ({ name, status: "connected" })));
  }

  async interrupt(): Promise<void> {
    this.currentTurn?.abort.abort();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.currentPermissionMode = mode;
    this.emit("mode", mode);
  }

  async setModel(id?: string): Promise<void> {
    this.currentModel = id?.trim() || this.requestedModel;
  }

  async setEffort(effort: Effort): Promise<void> {
    this.effort = effort;
  }

  async rewind(): Promise<void> {}

  respondPermission(): boolean {
    return false;
  }

  getPendingPermissions(): PendingPermission[] {
    return [];
  }

  getPermissionMode(): PermissionMode {
    return this.currentPermissionMode;
  }

  end(): void {
    this.dead = true;
    this.clearInactivityTimer();
    this.abortCurrentTurn();
    if (!this.settled) this.failTurn("Sessão encerrada.");
    void mcpHttpHost.unregister(this.mcpToken);
  }
}
