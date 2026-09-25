import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { BaseAgentSession } from "./base-session.js";
import type { AgentSessionInit } from "./types.js";
import { commitMessageGenerator, runCommitPush } from "../commit-push.js";

export class CommitPushSession extends BaseAgentSession {
  private readonly controller = new AbortController();
  private started = false;
  constructor(private readonly init: AgentSessionInit) { super(init); this.model = init.model ?? ""; }
  protected onInactivity(): void { this.controller.abort(); }
  sendUserMessage(): void {
    if (this.started) throw new Error("Commit/push já iniciado.");
    this.started = true;
    void Promise.resolve().then(async () => {
      const start = Date.now();
      let output = "", tokens = 0;
      const errors: string[] = [];
      try {
        tokens = await runCommitPush({ cwd: this.init.cwd, signal: this.controller.signal, generate: commitMessageGenerator(this.init.profile), progress: (text) => { output += text; this.emit("chunk", text); } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        output += `\n${message}\n`;
        this.emit("chunk", `\n${message}\n`);
      }
      this.dead = true;
      this.settleResult({ output, sessionId: "", durationMs: Date.now() - start, costUsd: 0, totalTokens: tokens, isError: errors.length > 0, errorMessages: errors, permissionDenials: [] });
    });
  }
  async interrupt(): Promise<void> { this.controller.abort(); }
  async setPermissionMode(): Promise<void> {}
  async setModel(): Promise<void> {}
  async setEffort(): Promise<void> {}
  async rewind(): Promise<void> { throw new Error("Commit/push não suporta rewind."); }
  respondPermission(): boolean { return false; }
  getPendingPermissions(): [] { return []; }
  getPermissionMode(): PermissionMode { return "bypassPermissions"; }
  end(): void { this.controller.abort(); this.dead = true; }
}
