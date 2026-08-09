export type BrainChannel = "email" | "calendar" | "whatsapp" | "slack" | "drive";
export type BrainSubchannel = "direct" | "group";
export type BrainTenant = "personal" | "biosoft";
export type TriageRelevance = 0 | 1 | 2 | 3;
export type WikiPageType =
  | "person"
  | "org"
  | "project"
  | "topic"
  | "thread"
  | "lesson"
  | "procedure"
  | "decision";

export interface CanonicalParticipant {
  name: string;
  handle: string;
  role: string;
}

export interface StoredAttachment {
  name: string;
  bytes: number;
  sha256: string;
  uri: string;
}

export interface CanonicalEvent {
  channel: BrainChannel;
  subchannel: BrainSubchannel;
  account: string;
  external_id: string;
  thread_key: string;
  occurred_at: string;
  participants: CanonicalParticipant[];
  subject: string;
  body_text: string;
  body_html?: string;
  attachments: StoredAttachment[];
  raw_ref?: string;
  bulk?: boolean;
}

export interface TriageResult {
  relevance: TriageRelevance;
  tenant: BrainTenant;
  contains_pii: 0 | 1;
  reason: string;
  entities: string[];
  projects: string[];
  has_commitment: boolean;
  has_deadline: boolean;
  action_required: boolean;
}

export interface TriageAnnotation extends TriageResult {
  classified_at: string;
  model: string;
}

export interface RawFrontmatter {
  id: string;
  channel: BrainChannel;
  subchannel: BrainSubchannel;
  account: string;
  thread_key: string;
  tenant: BrainTenant | "unknown";
  contains_pii: 0 | 1;
  occurred_from: string;
  occurred_to: string;
  ingested_at: string;
  participants: CanonicalParticipant[];
  subject: string;
  message_count: number;
  chatter_filtered: number;
  attachments: StoredAttachment[];
  raw_ref?: string;
  triage?: TriageAnnotation;
  compiled_into?: string[];
}

export interface WikiFrontmatter {
  type: WikiPageType;
  slug: string;
  title: string;
  tenant: BrainTenant;
  contains_pii: 0 | 1;
  aliases: string[];
  status: "active" | "dormant" | "archived";
  created_at: string;
  updated_at: string;
  reviewed_at: string;
  review_window: string;
  half_life: string;
  salience: number;
  related: string[];
  sources: string[];
  independent_sources: number;
  confidence: "low" | "medium" | "high";
  pinned: boolean;
}

export interface OpenLoopEntry {
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

export interface CompileSectionInput {
  section: string;
  content: string;
}

export type CompileOperation =
  | {
      op: "create_page";
      path: string;
      page_type: WikiPageType;
      title: string;
      tenant: BrainTenant;
      aliases: string[];
      sections: CompileSectionInput[];
      sources: string[];
    }
  | { op: "upsert_section"; path: string; section: string; content: string; sources: string[] }
  | { op: "append_history"; path: string; content: string; sources: string[] }
  | { op: "add_relation"; path: string; related: string; sources: string[] }
  | { op: "mark_superseded"; path: string; superseded_by: string | null; reason: string; sources: string[] };

export interface CompileOpenLoop {
  title: string;
  tenant: BrainTenant;
  kind: "my_commitment" | "waiting_on" | "decision_pending";
  counterparty: string;
  due: string | null;
  next_action: string;
  supersedes: string | null;
  sources: string[];
}

export interface CompileOutput {
  operations: CompileOperation[];
  open_loops: CompileOpenLoop[];
  log_entry: string;
  new_entities: { type: WikiPageType; slug: string; title: string }[];
}

export interface BrainLlmProviderFeatures {
  batch: boolean;
  caching: boolean;
  structuredOutputs: boolean;
}

export interface BrainLlmProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  features: BrainLlmProviderFeatures;
}

export interface BrainStageLlm {
  providerId: string;
  model: string;
}

export interface BrainRetrievalSettings {
  rerankMinScore: number;
  businessRanking: boolean;
  typeWeights: Record<WikiPageType, number>;
  halfLifeDays: Record<WikiPageType, number | null>;
  salienceBonus: number;
}

export interface BrainAccount {
  email: string;
  label: string;
  tenant: BrainTenant;
}

export interface BrainSettings {
  schedulers: {
    gmail: boolean;
    calendar: boolean;
    ingest: boolean;
    triage: boolean;
    compile: boolean;
    index: boolean;
    digest: boolean;
    whatsapp: boolean;
    slack: boolean;
    distill: boolean;
    lint: boolean;
    freshness: boolean;
  };
  cadences: {
    gmailMs: number;
    calendarMs: number;
    ingestMs: number;
    triageMs: number;
    compileMs: number;
    indexMs: number;
    whatsappMs: number;
    slackMs: number;
    freshnessMs: number;
  };
  chatter: {
    minChars: number;
    extraConfirmations: string[];
    samplePerWeek: number;
  };
  llm: {
    providers: BrainLlmProvider[];
    triage: BrainStageLlm;
    compile: BrainStageLlm;
    selector: BrainStageLlm;
    distill: BrainStageLlm;
    lint: BrainStageLlm;
  };
  compile: {
    minRelevance: number;
    maxSectionChars: number;
    contextPages: number;
    batchSize: number;
    maxPerTick: number;
  };
  accounts: BrainAccount[];
  tenantRules: {
    biosoftDomains: string[];
    biosoftKeywords: string[];
  };
  emailFilter: {
    skipCategories: string[];
    blockedSenders: string[];
    bulkAsNoise: boolean;
  };
  whatsapp: {
    tenant: BrainTenant;
  };
  slack: {
    tenant: BrainTenant;
  };
  gmailQuery: string;
  backfill: {
    monthsRaw: number;
    monthsCompile: number;
  };
  retrieval: BrainRetrievalSettings;
}

export const SCHEDULER_NAMES = [
  "gmail",
  "calendar",
  "ingest",
  "triage",
  "compile",
  "index",
  "digest",
  "whatsapp",
  "slack",
  "distill",
  "lint",
  "freshness",
] as const;

export type BrainSchedulerName = (typeof SCHEDULER_NAMES)[number];

export interface SchedulerStatus {
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
  schedulers: SchedulerStatus[];
  queues: { events: number; eventsPending: number; triage: number; compile: number };
  metrics: BrainDayMetrics[];
  quarantineCount: number;
  counts: { rawThreads: number; wikiPages: number };
  git: { head: string; dirty: number };
  backfill: BackfillState;
  alerts: string[];
}

export type QuarantineKind =
  | "malformed_event"
  | "ingest_failed"
  | "triage_failed"
  | "compile_failed"
  | "invalid_operations";

export interface QuarantineItem {
  id: string;
  kind: QuarantineKind;
  ts: string;
  threadKey: string | null;
  error: string;
  payload: unknown;
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

export type BrainDegraded = "sparse-only" | "dense-only" | "no-rerank" | "no-selector";

export interface BrainSearchHit {
  sourceKey: string;
  title: string;
  type: WikiPageType;
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

export interface ChatterSample {
  ts: string;
  channel: BrainChannel;
  threadKey: string;
  text: string;
  rule: string;
}

export interface RawMessageBlock {
  externalId: string;
  at: string;
  sender: string;
  lang: string;
  chatter: string | null;
  body: string;
}
