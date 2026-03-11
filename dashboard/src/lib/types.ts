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
  username?: string;
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
  username?: string;
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
  proxyDomain?: string;
  proxyPort?: number;
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
  | { role: "user"; id: string; name: string; projects: string[]; agents: string[]; trackerProjects: string[] };

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

// ── Tracker (Shape Up) ──

export type CycleStatus = "active" | "completed";
export type TestCasePriority = "critical" | "high" | "medium" | "low";
export type TestRunStatus = "passed" | "failed" | "blocked" | "skipped";

export interface CycleColumn {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface TrackerProject {
  id: string;
  name: string;
  code: string;
  description: string;
  nextItemNumber: number;
  createdBy: string;
  createdAt: string;
}

export interface TrackerCycle {
  id: string;
  projectId: string;
  name: string;
  status: CycleStatus;
  columns: CycleColumn[];
  createdBy: string;
  createdAt: string;
}

export interface ItemTestStats {
  total: number;
  passed: number;
  failed: number;
  noRuns: number;
}

export interface TrackerItem {
  id: string;
  cycleId: string;
  title: string;
  description: string;
  columnId: string;
  appetite: number;
  priority: string | null;
  startedAt: string | null;
  inScope: string;
  outOfScope: string;
  assignees: string[];
  tags: string[];
  seqNumber: number;
  position: number;
  testStats: ItemTestStats;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerItemSearchResult {
  id: string;
  code: string;
  title: string;
  cycleId: string;
  columnId: string;
}

export interface TrackerAttachment {
  id: string;
  commentId: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TrackerComment {
  id: string;
  targetType: "item";
  targetId: string;
  authorId: string;
  authorName: string;
  content: string;
  attachments: TrackerAttachment[];
  createdAt: string;
}

export interface TrackerTestCase {
  id: string;
  targetType: "item";
  targetId: string;
  title: string;
  description: string;
  preconditions: string;
  steps: string;
  expectedResult: string;
  priority: TestCasePriority;
  position: number;
  lastRunStatus?: TestRunStatus | null;
  passCount?: number;
  failCount?: number;
  totalRuns?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerTestRunAttachment {
  id: string;
  testRunId: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TrackerTestRunCommentAttachment {
  id: string;
  commentId: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TrackerTestRunComment {
  id: string;
  testRunId: string;
  authorId: string;
  authorName: string;
  content: string;
  attachments: TrackerTestRunCommentAttachment[];
  createdAt: string;
}

export interface TrackerTestRun {
  id: string;
  testCaseId: string;
  status: TestRunStatus;
  notes: string;
  executedBy: string;
  executedByName: string;
  executedAt: string;
  durationSeconds: number | null;
  attachments: TrackerTestRunAttachment[];
}
