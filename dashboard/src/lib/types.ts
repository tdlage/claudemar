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
  startedAt: string;
  completedAt: string | null;
  output: string;
  result: ClaudeResult | null;
  error: string | null;
}

export interface ClaudeResult {
  output: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  isError: boolean;
}

export interface AgentInfo {
  name: string;
  inboxCount: number;
  lastExecution: string | null;
}

export interface AgentDetail extends AgentInfo {
  claudeMd: string;
  inboxFiles: string[];
  outboxFiles: string[];
  outputFiles: { name: string; size: number; mtime: string }[];
  contextFiles: string[];
  schedules: ScheduleEntry[];
}

export interface ScheduleEntry {
  id: string;
  agent: string;
  cron: string;
  cronHuman: string;
  task: string;
  scriptPath: string;
}

export interface AgentFileContent {
  name: string;
  content: string;
  size: number;
  mtime: string;
}

export interface ProjectInfo {
  name: string;
}

export interface ProjectDetail {
  name: string;
  repos: RepoInfo[];
}

export interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  remoteUrl: string;
  hasChanges: boolean;
}

export interface RepoBranches {
  current: string;
  branches: string[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

export interface FileReadResult {
  type: "file" | "directory";
  content?: string;
  binary?: boolean;
  size?: number;
  entries?: FileEntry[];
}

export interface SessionSnapshot {
  mode: "projects" | "agents";
  activeProject: string | null;
  activeAgent: string | null;
  busy: boolean;
  sessionId: string | null;
  activeExecutions: number;
  uptime: number;
}

export interface AgentMetrics {
  executions: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

export interface QueueItem {
  id: string;
  seqId: number;
  targetType: ExecutionTargetType;
  targetName: string;
  prompt: string;
  source: ExecutionSource;
  enqueuedAt: string;
}
