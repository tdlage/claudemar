import { EventEmitter } from "node:events";
import type { AgentResult } from "../providers/types.js";
import { ingestTurn, type MemoryTarget } from "../memory/session-memory.js";
import { DEFAULT_PROJECT_MODEL } from "../models-discovery.js";
import type { AgentSession, AgentSessionInit, MessageBlock, PendingPermission, PermissionDecision, Effort } from "./types.js";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// Janela de contexto usada como fallback quando o runtime não expõe o máximo do modelo —
// sobrescrevível por CONTEXT_WINDOW_TOKENS.
export const DEFAULT_CONTEXT_WINDOW = Number(process.env.CONTEXT_WINDOW_TOKENS) || 200000;

export function blocksToText(blocksOrText: string | MessageBlock[]): string {
  if (typeof blocksOrText === "string") return blocksOrText;
  return blocksOrText.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
}

export function contextPercent(used: number, max: number): number {
  if (max <= 0 || used <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export abstract class BaseAgentSession extends EventEmitter implements AgentSession {
  readonly target: MemoryTarget;
  readonly planMode: boolean;
  readonly agentName?: string;
  readonly schedulerMode: boolean;
  protected readonly requestedModel: string;
  protected sessionId = "";
  protected model = "";
  protected assistantBuffer = "";
  protected pendingUserText: string | null = null;
  protected result: AgentResult | null = null;
  protected settled = false;
  protected dead = false;
  protected inactivityExpired = false;
  private inactivityTimeoutMs: number;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(init: AgentSessionInit) {
    super();
    this.setMaxListeners(50);
    this.target = init.target;
    this.planMode = Boolean(init.planMode);
    this.agentName = init.agentName;
    this.schedulerMode = Boolean(init.schedulerMode);
    this.requestedModel = init.model ?? DEFAULT_PROJECT_MODEL;
    this.inactivityTimeoutMs = init.inactivityTimeoutMs ?? 0;
  }

  protected abstract onInactivity(): void;

  protected startInactivityTimer(): void {
    if (this.inactivityTimeoutMs <= 0 || this.inactivityExpired || this.dead || this.settled) return;
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.inactivityExpired = true;
      this.onInactivity();
    }, this.inactivityTimeoutMs);
  }

  protected resetInactivityTimer(): void {
    if (this.inactivityExpired || this.dead || this.settled) return;
    this.startInactivityTimer();
  }

  protected clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  protected ingestResult(result: AgentResult): void {
    if (this.pendingUserText) {
      ingestTurn(this.target, result.sessionId, "user", this.pendingUserText);
      this.pendingUserText = null;
    }
    if (result.output.trim()) {
      ingestTurn(this.target, result.sessionId, "assistant", result.output, { model: this.model });
    }
  }

  protected settleResult(result: AgentResult): void {
    this.clearInactivityTimer();
    this.result = result;
    this.settled = true;
    this.assistantBuffer = "";
    this.emit("result", result);
  }

  protected failTurn(message: string): void {
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

  getSessionId(): string {
    return this.sessionId;
  }

  getModel(): string {
    return this.model;
  }

  getRequestedModel(): string {
    return this.requestedModel;
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

  abstract sendUserMessage(blocksOrText: string | MessageBlock[], ingestText?: string): void;
  abstract interrupt(): Promise<void>;
  abstract setPermissionMode(mode: PermissionMode): Promise<void>;
  abstract setModel(id?: string): Promise<void>;
  abstract setEffort(effort: Effort): Promise<void>;
  abstract rewind(uuid: string): Promise<void>;
  abstract respondPermission(reqId: string, decision: PermissionDecision): boolean;
  abstract getPendingPermissions(): PendingPermission[];
  abstract getPermissionMode(): PermissionMode;
  abstract end(): void;
}
