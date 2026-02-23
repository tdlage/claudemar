export type ExecutionSource = "telegram" | "web";
export type ExecutionTargetType = "orchestrator" | "project" | "agent";
export type ExecutionStatus = "running" | "completed" | "error" | "cancelled";

export interface QuestionOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

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
  startedAt: string;
  completedAt: string | null;
  output: string;
  result: ClaudeResult | null;
  error: string | null;
  pendingQuestion?: PendingQuestion | null;
  planMode?: boolean;
  resumeSessionId?: string | null;
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

export interface AgentSecret {
  id: string;
  name: string;
  maskedValue: string;
  description: string;
}

export interface SecretFile {
  name: string;
  size: number;
  description: string;
}

export interface AgentDetail extends AgentInfo {
  claudeMd: string;
  inboxFiles: string[];
  outboxFiles: string[];
  outputFiles: { name: string; type: "file" | "directory"; size: number; mtime: string }[];
  inputFiles: { name: string; size: number; mtime: string }[];
  contextFiles: string[];
  schedules: ScheduleEntry[];
  secrets: AgentSecret[];
  secretFiles: SecretFile[];
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
  repoCount: number;
  hasChanges: boolean;
}

export interface ProjectDetail {
  name: string;
  repos: RepoInfo[];
  inputFiles: { name: string; size: number; mtime: string }[];
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
  agentName?: string;
  prompt: string;
  source: ExecutionSource;
  enqueuedAt: string;
  resumeSessionId?: string | null;
}

export interface GitFileStatus {
  status: string;
  path: string;
}

export interface GitFileDiff {
  original: string;
  modified: string;
}

export interface RunConfig {
  id: string;
  name: string;
  command: string;
  workingDirectory: string;
  envVars: Record<string, string>;
  projectName: string;
  status?: { running: boolean; pid?: number; startedAt?: string };
}

export interface SessionData {
  sessionId: string | null;
  history: string[];
  names: Record<string, string>;
}

export interface SearchMatch {
  line: number;
  content: string;
}

export interface SearchResponse {
  results: Record<string, SearchMatch[]>;
  count: number;
}

export type MeResponse =
  | { role: "admin" }
  | { role: "user"; id: string; name: string; projects: string[]; agents: string[] };

export interface RuntimeSettings {
  sesFrom: string;
  adminEmail: string;
}

export interface EmailProfileMasked {
  name: string;
  awsAccessKeyId: string;
  awsSecretAccessKeyMasked: string;
  region: string;
  from: string;
  senderName: string;
}
