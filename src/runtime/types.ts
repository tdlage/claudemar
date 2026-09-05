import type { EventEmitter } from "node:events";
import type { AgentDefinition, McpServerConfig, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AgentResult } from "../providers/types.js";
import type { MemoryTarget } from "../memory/session-memory.js";

export const EFFORTS = ["minimal", "low", "medium", "high", "extra", "max", "ultracode"] as const;
export type Effort = (typeof EFFORTS)[number];

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

export type SubagentTaskStatus = "running" | "completed" | "failed" | "stopped" | "killed";

export interface TaskEvent {
  phase: "started" | "progress" | "updated" | "done";
  taskId: string;
  description?: string;
  subagentType?: string;
  taskType?: string;
  workflowName?: string;
  status?: SubagentTaskStatus;
  tokens?: number;
  toolUses?: number;
  durationMs?: number;
  lastToolName?: string;
  summary?: string;
  error?: string;
}

export interface AgentSessionInit {
  cwd: string;
  target: MemoryTarget;
  model?: string;
  agentName?: string;
  planMode?: boolean;
  permissionMode?: PermissionMode;
  bypassPermissions?: boolean;
  resumeSessionId?: string | null;
  forkSession?: boolean;
  effort?: Effort;
  systemAppend?: string;
  subagents?: Record<string, AgentDefinition>;
  schedulerMode?: boolean;
  extraMcpServers?: Record<string, McpServerConfig>;
  skills?: string[];
  stderr?: (data: string) => void;
  permissionTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  pendingTasksGraceMs?: number;
}

// Contrato comum dos runtimes (Claude Agent SDK e Codex SDK). Eventos emitidos:
// chunk, thinking, toolUse, sessionId, usage, result, failure, stderr, mode, slashCommands,
// mcpStatus, compact, checkpoint, task, tasksPending, permission, permissionResolved.
export interface AgentSession extends EventEmitter {
  readonly target: MemoryTarget;
  readonly planMode: boolean;
  readonly agentName?: string;
  readonly schedulerMode: boolean;
  sendUserMessage(blocksOrText: string | MessageBlock[], ingestText?: string): void;
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(id?: string): Promise<void>;
  setEffort(effort: Effort): Promise<void>;
  rewind(uuid: string): Promise<void>;
  respondPermission(reqId: string, decision: PermissionDecision): boolean;
  getPendingPermissions(): PendingPermission[];
  getSessionId(): string;
  getModel(): string;
  getRequestedModel(): string;
  getPermissionMode(): PermissionMode;
  getLastResult(): AgentResult | null;
  waitForResult(): Promise<AgentResult>;
  isAlive(): boolean;
  end(): void;
}
