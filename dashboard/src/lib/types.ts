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
  model?: string;
  runtime?: AgentRuntime;
  username?: string;
  prompt: string;
  cwd: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt: string | null;
  output: string;
  result: AgentResult | null;
  error: string | null;
  pendingQuestion?: PendingQuestion | null;
  planMode?: boolean;
  resumeSessionId?: string | null;
  liveUsage?: ExecutionUsage;
}

export interface ExecutionUsage {
  costUsd: number;
  tokens: number;
  contextPct: number;
}

export interface AgentResult {
  output: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  isError: boolean;
}

export function formatUsage(costUsd: number, totalTokens?: number): string {
  if (costUsd > 0) return `$${costUsd.toFixed(2)}`;
  if (totalTokens && totalTokens > 0) {
    return totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k tok`
      : `${totalTokens} tok`;
  }
  return "$0.00";
}

export interface AgentInfo {
  name: string;
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
  agentsMd: string;
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
  createdAt?: string;
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
  model?: string;
}

export const PROJECT_SELECTABLE_MODELS: { model: string; displayName: string }[] = [
  { model: "claude-opus-5", displayName: "Opus 5" },
  { model: "claude-fable-5-1", displayName: "Fable 5.1" },
];

export const DEFAULT_PROJECT_MODEL = "claude-opus-5";

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

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  prunable: boolean;
  hasChanges: boolean;
  ahead: number;
  behind: number;
  baseBranch: string;
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
  models: Record<string, string>;
  runtimes: Record<string, AgentRuntime>;
}

export interface SearchMatch {
  line: number;
  content: string;
}

export interface SearchResponse {
  results: Record<string, SearchMatch[]>;
  count: number;
}

export const PROJECT_TAB_KEYS = ["terminal", "input", "output", "repositories", "files", "ci", "pipeline"] as const;
export type ProjectTabKey = (typeof PROJECT_TAB_KEYS)[number];
export const DEFAULT_PROJECT_TABS: ProjectTabKey[] = ["terminal", "input", "output"];

export type MeResponse =
  | { role: "admin" }
  | { role: "user"; id: string; name: string; projects: string[]; agents: string[]; trackerProjects: string[]; projectTabs: Record<string, ProjectTabKey[]> };

export type AgentRuntime = "claude" | "codex";

export interface LlmProfile {
  id: string;
  label: string;
  runtime: AgentRuntime;
  baseUrl: string;
  tokenEnv: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  timeoutMs: string;
  autoCompactWindow: string;
  extraEnv: string;
}

export interface RuntimeSettings {
  sesFrom: string;
  adminEmail: string;
  llmProfiles: LlmProfile[];
  activeProfileId: string;
}

export interface CodexAuthStatus {
  loggedIn: boolean;
  method: "chatgpt" | "api" | "none";
  detail: string;
  checkedAt: number;
  authError: { at: number; message: string } | null;
}

export interface CodexLoginState {
  status: "idle" | "pending" | "done" | "error";
  url: string;
  code: string;
  startedAt: number;
  error: string;
}

export interface ProviderInfo {
  provider: string;
  label: string;
  runtime: AgentRuntime;
  model: string;
  nativeAnthropic: boolean;
  defaultModel: string;
  selectableModels: { model: string; displayName: string }[];
  configured: boolean;
}

export interface EnvKeyStatus {
  key: string;
  label: string;
  group: string;
  help: string;
  required: boolean;
  present: boolean;
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
export type CycleType = "features" | "bugs";
export type ItemType = "feature" | "bug";
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
  type: CycleType;
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
  type: ItemType;
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

export interface ProjectBoardItem extends TrackerItem {
  cycleName: string;
  cycleType: CycleType;
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

export interface TrackerItemCommit {
  id: string;
  itemId: string;
  repo: string;
  commitHash: string;
  message: string;
  committedAt: string;
  createdAt: string;
}

// ── CI / GitHub Actions ──

export interface CIWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface CIWorkflowRun {
  id: number;
  name: string;
  displayTitle: string;
  headBranch: string;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  runNumber: number;
  workflowId: number;
  actor: string;
}

export interface CIWorkflowRunJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  steps: CIWorkflowRunStep[];
}

export interface CIWorkflowRunStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

export interface CIWebhookEvent {
  action: string;
  owner: string;
  repo: string;
  repoFullName: string;
  runId: number;
  runNumber: number;
  name: string;
  displayTitle: string;
  headBranch: string;
  event: string;
  status: string;
  conclusion: string | null;
  url: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
}

export type ItemPlanStatus = "planning" | "planned" | "executing" | "reviewing" | "completed" | "error";

export interface TrackerItemPlan {
  id: string;
  itemId: string;
  targetProject: string;
  sessionId: string | null;
  status: ItemPlanStatus;
  promptSent: string;
  planMarkdown: string | null;
  pendingQuestions: AskQuestion[] | null;
  lastExecutionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAppearance {
  color: string | null;
  emoji: string | null;
}

// ── Pipeline ──

export type PipelineStage =
  | "intake" | "requirement" | "plan" | "implementation" | "code_review" | "e2e" | "pull_request";

export type PipelineCardStatus = "idle" | "running" | "awaiting_gate" | "failed" | "done";
export type PipelineRunStatus = "running" | "passed" | "failed" | "error" | "cancelled";
export type PipelineRepoStatus = "pending" | "worktree" | "pushed" | "pr_open" | "merged" | "closed";
export type IntakePluginType = "manual" | "github_issues" | "usage_pattern" | "agent";

export interface PipelineStageArtifacts {
  requirement?: string;
  plan?: { markdown: string; repos: string[] };
  tests?: { passed: boolean; total: number; failed: number; logs?: string };
  review?: { totalFindings: number; fixed: number; clean: boolean; testsPass: boolean; summary?: string };
  e2e?: { passed: boolean; screenshots: string[]; logs?: string };
  prs?: { repo: string; url: string; number: number }[];
  items?: { title: string; input: string }[];
}

export interface Pipeline {
  id: string;
  projectName: string;
  defaultBaseBranch: string;
  nextCardNumber: number;
  defaultAuto: boolean;
  createdBy: string;
  createdAt: string;
}

export interface PipelineStageConfig {
  id: string;
  pipelineId: string;
  stage: PipelineStage;
  promptTemplate: string;
  skill: string | null;
  agentName: string | null;
  timeoutMs: number | null;
}

export interface PipelineIntakePlugin {
  id: string;
  pipelineId: string;
  type: IntakePluginType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  cron: string | null;
  scheduleId: string | null;
  createdAt: string;
}

export interface PipelineCardRepo {
  id: string;
  cardId: string;
  repoName: string;
  baseBranch: string;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  prNumber: number | null;
  repoStatus: PipelineRepoStatus;
}

export interface PipelineCard {
  id: string;
  pipelineId: string;
  seqNumber: number;
  title: string;
  stage: PipelineStage;
  status: PipelineCardStatus;
  auto: boolean;
  originType: IntakePluginType;
  originRef: string | null;
  intakeInput: string;
  requirementText: string;
  planMarkdown: string;
  sessionId: string | null;
  implementationRetries: number;
  codeReviewRetries: number;
  e2eRetries: number;
  revisionCount: number;
  position: number;
  lastFeedback: string | null;
  skippedStages: PipelineStage[];
  model: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  repos: PipelineCardRepo[];
  totalCostUsd: number;
  totalTokens: number;
  contextPct: number;
}

export interface PipelineStageRun {
  id: string;
  cardId: string;
  stage: PipelineStage;
  attempt: number;
  execId: string | null;
  sessionId: string | null;
  status: PipelineRunStatus;
  promptSent: string;
  output: string;
  artifacts: PipelineStageArtifacts;
  costUsd: number;
  totalTokens: number;
  contextPct: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface PipelineRunUsageEvent {
  cardId: string;
  runId: string;
  run: { costUsd: number; totalTokens: number; contextPct: number };
  card: { totalCostUsd: number; totalTokens: number; contextPct: number };
}

export interface PipelineBundle {
  pipeline: Pipeline | null;
  stageConfigs: PipelineStageConfig[];
  plugins: PipelineIntakePlugin[];
  repos: string[];
}


// ── Second Brain ──

export type BrainChannel = "email" | "calendar" | "whatsapp" | "slack" | "drive";
export type BrainTenant = string;
export interface BrainChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BrainChatResponse {
  reply: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
  rounds: number;
}

export interface BrainTenantEntry {
  id: string;
  label: string;
  parent: string | null;
  aliases: string[];
  domains: string[];
  identifiers: string[];
  threads: number;
  created_at: string;
  updated_at: string;
  merged_into: string | null;
}

export type BrainSchedulerName = "gmail" | "calendar" | "ingest" | "triage" | "compile" | "index" | "digest" | "whatsapp" | "slack" | "distill" | "lint" | "freshness";

export interface BrainParticipant {
  name: string;
  handle: string;
  role: string;
}

export interface BrainAttachment {
  name: string;
  bytes: number;
  sha256: string;
  uri: string;
}

export interface BrainTriage {
  relevance: 0 | 1 | 2 | 3;
  tenant: BrainTenant;
  contains_pii: 0 | 1;
  reason: string;
  entities: string[];
  projects: string[];
  has_commitment: boolean;
  has_deadline: boolean;
  action_required: boolean;
  classified_at: string;
  model: string;
}

export interface RawThreadFrontmatter {
  id: string;
  channel: BrainChannel;
  subchannel: "direct" | "group";
  account: string;
  thread_key: string;
  tenant: BrainTenant;
  contains_pii: 0 | 1;
  occurred_from: string;
  occurred_to: string;
  ingested_at: string;
  participants: BrainParticipant[];
  subject: string;
  message_count: number;
  chatter_filtered: number;
  attachments: BrainAttachment[];
  raw_ref?: string;
  triage?: BrainTriage;
  compiled_into?: string[];
}

export interface RawThreadListItem {
  path: string;
  frontmatter: RawThreadFrontmatter;
}

export interface RawThreadBlock {
  externalId: string;
  at: string;
  sender: string;
  lang: string;
  chatter: string | null;
  body: string;
}

export interface RawThread {
  path: string;
  frontmatter: RawThreadFrontmatter;
  blocks: RawThreadBlock[];
}

export interface BrainChannelSummary {
  channel: string;
  threads: number;
  months: string[];
  firstAt: string | null;
  lastAt: string | null;
}

export interface BrainSchedulerStatus {
  name: BrainSchedulerName;
  enabled: boolean;
  inFlight: boolean;
  lastHeartbeat: string | null;
  lastError: string;
  disabledReason: string | null;
}

export interface GoogleAccountStatus {
  email: string;
  label: string;
  tenant: BrainTenant;
  connected: boolean;
  reauthRequired: boolean;
  expiryDate: string | null;
}

export interface BrainDayMetrics {
  date: string;
  fields: Record<string, number>;
}

export interface BackfillProgress {
  currentAccount: string | null;
  currentMonth: string | null;
  processed: number;
  total: number;
  batchId: string | null;
  detail: string;
}

export interface BackfillState {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  phase: "raw" | "triage" | "compile" | null;
  accounts: string[];
  monthsRaw: number;
  monthsCompile: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string;
  progress: BackfillProgress;
}

export interface BrainStatus {
  redis: { reachable: boolean; lastError: string };
  google: { configured: boolean; accounts: GoogleAccountStatus[] };
  schedulers: BrainSchedulerStatus[];
  queues: { events: number; eventsPending: number; triage: number; compile: number };
  metrics: BrainDayMetrics[];
  quarantineCount: number;
  counts: { rawThreads: number; wikiPages: number };
  git: { head: string; dirty: number };
  backfill: BackfillState;
  alerts: string[];
}

export interface BrainLlmProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  features: { batch: boolean; caching: boolean; structuredOutputs: boolean };
}

export interface BrainStageLlm {
  providerId: string;
  model: string;
}

export type BrainWikiPageType = "person" | "org" | "project" | "topic" | "thread" | "lesson" | "procedure" | "decision";

export interface BrainRetrievalSettings {
  rerankMinScore: number;
  businessRanking: boolean;
  typeWeights: Record<BrainWikiPageType, number>;
  halfLifeDays: Record<BrainWikiPageType, number | null>;
  salienceBonus: number;
}

export interface BrainRecallDistribution {
  month: string;
  total: number;
  scored: number;
  bins: { from: number; to: number; count: number }[];
  percentiles: { p25: number | null; p50: number | null; p75: number | null };
}

export interface BrainAccountSetting {
  email: string;
  label: string;
  tenant: BrainTenant;
}

export interface BrainSettings {
  schedulers: Record<BrainSchedulerName, boolean>;
  cadences: { gmailMs: number; calendarMs: number; ingestMs: number; triageMs: number; compileMs: number; indexMs: number; whatsappMs: number; slackMs: number; freshnessMs: number };
  chatter: { minChars: number; extraConfirmations: string[]; samplePerWeek: number };
  llm: { providers: BrainLlmProvider[]; triage: BrainStageLlm; compile: BrainStageLlm; selector: BrainStageLlm; distill: BrainStageLlm; lint: BrainStageLlm };
  compile: { minRelevance: number; maxSectionChars: number; contextPages: number; batchSize: number; maxPerTick: number };
  accounts: BrainAccountSetting[];
  emailFilter: { skipCategories: string[]; blockedSenders: string[]; bulkAsNoise: boolean };
  gmailQuery: string;
  backfill: { monthsRaw: number; monthsCompile: number };
  retrieval: BrainRetrievalSettings;
}

export interface BrainQuarantineItem {
  id: string;
  kind: "malformed_event" | "ingest_failed" | "triage_failed" | "compile_failed" | "invalid_operations";
  ts: string;
  threadKey: string | null;
  error: string;
  payload?: unknown;
}

export interface BrainActivityItem {
  at: string;
  kind:
    | "ingest"
    | "triage"
    | "compile"
    | "quarantine"
    | "connector"
    | "backfill"
    | "index"
    | "digest"
    | "distill"
    | "lint"
    | "alert";
  label: string;
  path?: string;
}

export interface BrainChatterSample {
  ts: string;
  channel: string;
  threadKey: string;
  text: string;
  rule: string;
}

export interface WikiPageSummary {
  path: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  updated_at: string;
  confidence: string;
}

export interface WikiTreeSection {
  dir: string;
  pages: WikiPageSummary[];
}

export interface WikiPage {
  path: string;
  ref?: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface WikiVersion {
  sha: string;
  date: string;
  message: string;
}

export interface BrainOpenLoop {
  id: string;
  title: string;
  tenant: BrainTenant;
  kind: "my_commitment" | "waiting_on" | "decision_pending";
  counterparty: string;
  opened_at: string;
  due: string | null;
  last_movement: string;
  status: "open" | "done" | "superseded" | "abandoned";
  supersedes: string | null;
  sources: string[];
  next_action: string;
}

export type BrainDegraded = "sparse-only" | "dense-only" | "no-rerank" | "no-selector";

export interface BrainSearchHit {
  sourceKey: string;
  title: string;
  type: WikiPageSummary["type"];
  tenant: BrainTenant;
  text: string;
  rerankScore: number | null;
  updatedAt: string;
  containsPii: boolean;
}

export interface BrainSearchResult {
  hits: BrainSearchHit[];
  degraded: BrainDegraded[];
  candidatesRrf: number;
  topRerankScore: number | null;
  minRerankScore: number | null;
  belowThreshold: number;
  ranked: boolean;
  durationMs: number;
}

export interface BrainRecallLine {
  ts: string;
  surface: string;
  tool: string;
  scope: { targetType: string; targetName: string };
  query: string;
  requested: number;
  candidates_rrf: number;
  returned_ids: string[];
  top_rerank_score: number | null;
  min_rerank_score: number | null;
  duration_ms: number;
  degraded: string | null;
  ranked?: boolean;
}

export interface BrainIndexStatus {
  enabled: boolean;
  trackedFiles: number;
  lastFull: string | null;
  reindexRunning: boolean;
  points: number;
  currentPoints: number;
}
