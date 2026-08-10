import { resolve } from "node:path";
import { config } from "../config.js";
import { JsonPersister } from "../json-persister.js";
import { DEFAULT_HALF_LIFE_DAYS, DEFAULT_SALIENCE_BONUS, DEFAULT_TYPE_WEIGHTS } from "./ranking.js";
import { SCHEDULER_NAMES } from "./types.js";
import { ROOT_TENANT } from "./tenants.js";
import { slugify } from "./text.js";
import type {
  BrainAccount,
  BrainLlmProvider,
  BrainSettings,
  BrainStageLlm,
  BrainTenant,
  WikiPageType,
} from "./types.js";

export const DEFAULT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_COMPILE_MODEL = "claude-sonnet-5";
export const DEFAULT_SELECTOR_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_DISTILL_MODEL = "claude-sonnet-5";
export const DEFAULT_LINT_MODEL = "claude-sonnet-5";

function defaultProviders(): BrainLlmProvider[] {
  return [
    {
      id: "anthropic",
      label: "Anthropic",
      baseUrl: "",
      apiKeyEnv: "BRAIN_ANTHROPIC_API_KEY",
      features: { batch: true, caching: true, structuredOutputs: true },
    },
    {
      id: "kimi",
      label: "Kimi Code",
      baseUrl: "https://api.kimi.com/coding",
      apiKeyEnv: "KIMI_API_KEY",
      features: { batch: false, caching: false, structuredOutputs: false },
    },
    {
      id: "zai",
      label: "z.ai (GLM)",
      baseUrl: "https://api.z.ai/api/anthropic",
      apiKeyEnv: "ZAI_API_KEY",
      features: { batch: false, caching: false, structuredOutputs: false },
    },
  ];
}

function defaults(): BrainSettings {
  return {
    schedulers: {
      gmail: true,
      calendar: true,
      ingest: true,
      triage: false,
      compile: false,
      index: true,
      digest: true,
      whatsapp: false,
      slack: false,
      distill: false,
      lint: false,
      freshness: true,
    },
    cadences: {
      gmailMs: 120_000,
      calendarMs: 300_000,
      ingestMs: 5_000,
      triageMs: 60_000,
      compileMs: 300_000,
      indexMs: 300_000,
      whatsappMs: 300_000,
      slackMs: 60_000,
      freshnessMs: 3_600_000,
    },
    chatter: { minChars: 12, extraConfirmations: [], samplePerWeek: 20 },
    llm: {
      providers: defaultProviders(),
      triage: { providerId: "anthropic", model: DEFAULT_TRIAGE_MODEL },
      compile: { providerId: "anthropic", model: DEFAULT_COMPILE_MODEL },
      selector: { providerId: "anthropic", model: DEFAULT_SELECTOR_MODEL },
      distill: { providerId: "anthropic", model: DEFAULT_DISTILL_MODEL },
      lint: { providerId: "anthropic", model: DEFAULT_LINT_MODEL },
    },
    compile: { minRelevance: 2, maxSectionChars: 4000, contextPages: 6, batchSize: 20, maxPerTick: 100 },
    accounts: [],
    emailFilter: { skipCategories: ["promotions", "social"], blockedSenders: [], bulkAsNoise: true },
    gmailQuery: "",
    backfill: { monthsRaw: 12, monthsCompile: 3 },
    retrieval: {
      rerankMinScore: config.rerankMinScore,
      businessRanking: false,
      typeWeights: { ...DEFAULT_TYPE_WEIGHTS },
      halfLifeDays: { ...DEFAULT_HALF_LIFE_DAYS },
      salienceBonus: DEFAULT_SALIENCE_BONUS,
    },
  };
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function num(raw: unknown, fallback: number, min = 0): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= min ? raw : fallback;
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

function strArr(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function tenant(raw: unknown): BrainTenant {
  return typeof raw === "string" && raw.trim() ? slugify(raw, 48) : ROOT_TENANT;
}

function sanitizeProviders(raw: unknown): BrainLlmProvider[] {
  if (!Array.isArray(raw)) return defaultProviders();
  const seen = new Set<string>();
  const providers: BrainLlmProvider[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = str(e.id, "").trim();
    const apiKeyEnv = str(e.apiKeyEnv, "").trim();
    if (!id || !apiKeyEnv || seen.has(id) || !/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv)) continue;
    seen.add(id);
    const features = (e.features ?? {}) as Record<string, unknown>;
    providers.push({
      id,
      label: str(e.label, id),
      baseUrl: str(e.baseUrl, "").trim(),
      apiKeyEnv,
      features: {
        batch: bool(features.batch, false),
        caching: bool(features.caching, false),
        structuredOutputs: bool(features.structuredOutputs, false),
      },
    });
  }
  return providers.length > 0 ? providers : defaultProviders();
}

function sanitizeStage(raw: unknown, providers: BrainLlmProvider[], fallback: BrainStageLlm): BrainStageLlm {
  const e = (raw ?? {}) as Record<string, unknown>;
  const providerId = str(e.providerId, fallback.providerId);
  const model = str(e.model, fallback.model).trim() || fallback.model;
  const valid = providers.some((p) => p.id === providerId);
  return { providerId: valid ? providerId : (providers[0]?.id ?? fallback.providerId), model };
}

function sanitizeAccounts(raw: unknown): BrainAccount[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const accounts: BrainAccount[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const email = str(e.email, "").trim().toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    accounts.push({ email, label: str(e.label, email), tenant: tenant(e.tenant) });
  }
  return accounts;
}

const PAGE_TYPES: WikiPageType[] = ["person", "org", "project", "topic", "thread", "lesson", "procedure", "decision"];

function sanitizeTypeWeights(raw: unknown, fallback: Record<WikiPageType, number>): Record<WikiPageType, number> {
  const e = (raw ?? {}) as Record<string, unknown>;
  const out = { ...fallback };
  for (const type of PAGE_TYPES) {
    const value = e[type];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[type] = value;
  }
  return out;
}

function sanitizeHalfLives(
  raw: unknown,
  fallback: Record<WikiPageType, number | null>,
): Record<WikiPageType, number | null> {
  const e = (raw ?? {}) as Record<string, unknown>;
  const out = { ...fallback };
  for (const type of PAGE_TYPES) {
    const value = e[type];
    if (value === null) out[type] = null;
    else if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[type] = value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!isPlainObject(patch)) return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return out;
}

function sanitize(raw: unknown): BrainSettings {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const sch = (r.schedulers ?? {}) as Record<string, unknown>;
  const cad = (r.cadences ?? {}) as Record<string, unknown>;
  const chat = (r.chatter ?? {}) as Record<string, unknown>;
  const llm = (r.llm ?? {}) as Record<string, unknown>;
  const comp = (r.compile ?? {}) as Record<string, unknown>;
  const ef = (r.emailFilter ?? {}) as Record<string, unknown>;
  const bf = (r.backfill ?? {}) as Record<string, unknown>;
  const ret = (r.retrieval ?? {}) as Record<string, unknown>;
  const providers = sanitizeProviders(llm.providers);
  return {
    schedulers: Object.fromEntries(
      SCHEDULER_NAMES.map((name) => [name, bool(sch[name], d.schedulers[name])]),
    ) as BrainSettings["schedulers"],
    cadences: {
      gmailMs: num(cad.gmailMs, d.cadences.gmailMs, 15_000),
      calendarMs: num(cad.calendarMs, d.cadences.calendarMs, 15_000),
      ingestMs: num(cad.ingestMs, d.cadences.ingestMs, 1_000),
      triageMs: num(cad.triageMs, d.cadences.triageMs, 15_000),
      compileMs: num(cad.compileMs, d.cadences.compileMs, 30_000),
      indexMs: num(cad.indexMs, d.cadences.indexMs, 60_000),
      whatsappMs: num(cad.whatsappMs, d.cadences.whatsappMs, 60_000),
      slackMs: num(cad.slackMs, d.cadences.slackMs, 15_000),
      freshnessMs: num(cad.freshnessMs, d.cadences.freshnessMs, 300_000),
    },
    chatter: {
      minChars: num(chat.minChars, d.chatter.minChars),
      extraConfirmations: strArr(chat.extraConfirmations),
      samplePerWeek: num(chat.samplePerWeek, d.chatter.samplePerWeek),
    },
    llm: {
      providers,
      triage: sanitizeStage(llm.triage, providers, d.llm.triage),
      compile: sanitizeStage(llm.compile, providers, d.llm.compile),
      selector: sanitizeStage(llm.selector, providers, d.llm.selector),
      distill: sanitizeStage(llm.distill, providers, d.llm.distill),
      lint: sanitizeStage(llm.lint, providers, d.llm.lint),
    },
    compile: {
      minRelevance: num(comp.minRelevance, d.compile.minRelevance),
      maxSectionChars: num(comp.maxSectionChars, d.compile.maxSectionChars, 200),
      contextPages: num(comp.contextPages, d.compile.contextPages),
      batchSize: num(comp.batchSize, d.compile.batchSize, 1),
      maxPerTick: num(comp.maxPerTick, d.compile.maxPerTick, 1),
    },
    accounts: sanitizeAccounts(r.accounts),
    emailFilter: {
      skipCategories: (Array.isArray(ef.skipCategories)
        ? strArr(ef.skipCategories)
        : d.emailFilter.skipCategories
      ).filter((c) => ["promotions", "social", "updates", "forums"].includes(c)),
      blockedSenders: strArr(ef.blockedSenders),
      bulkAsNoise: bool(ef.bulkAsNoise, d.emailFilter.bulkAsNoise),
    },
    gmailQuery: str(r.gmailQuery, d.gmailQuery),
    backfill: {
      monthsRaw: num(bf.monthsRaw, d.backfill.monthsRaw, 1),
      monthsCompile: num(bf.monthsCompile, d.backfill.monthsCompile, 1),
    },
    retrieval: {
      rerankMinScore: num(ret.rerankMinScore, d.retrieval.rerankMinScore),
      businessRanking: bool(ret.businessRanking, d.retrieval.businessRanking),
      typeWeights: sanitizeTypeWeights(ret.typeWeights, d.retrieval.typeWeights),
      halfLifeDays: sanitizeHalfLives(ret.halfLifeDays, d.retrieval.halfLifeDays),
      salienceBonus: num(ret.salienceBonus, d.retrieval.salienceBonus),
    },
  };
}

function clone(settings: BrainSettings): BrainSettings {
  return JSON.parse(JSON.stringify(settings)) as BrainSettings;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

class BrainSettingsManager {
  private data: BrainSettings = defaults();
  private snapshot: BrainSettings = this.data;
  private persister = new JsonPersister(resolve(config.dataPath, "brain-settings.json"), "brain-settings");

  constructor() {
    const raw = this.persister.readSync();
    if (raw) this.data = sanitize(raw);
    this.snapshot = deepFreeze(clone(this.data));
  }

  private touched(): void {
    this.snapshot = deepFreeze(clone(this.data));
    this.persister.scheduleWrite(() => this.data);
  }

  get(): BrainSettings {
    return this.snapshot;
  }

  update(patch: unknown): BrainSettings {
    const merged = deepMerge(this.data as unknown as Record<string, unknown>, patch);
    this.data = sanitize(merged);
    this.touched();
    return clone(this.snapshot);
  }

  upsertAccount(email: string, patch?: Partial<BrainAccount>): void {
    const normalized = email.trim().toLowerCase();
    const existing = this.data.accounts.find((a) => a.email === normalized);
    if (existing) {
      if (patch?.label !== undefined) existing.label = patch.label;
      if (patch?.tenant !== undefined) existing.tenant = patch.tenant;
    } else {
      this.data.accounts.push({
        email: normalized,
        label: patch?.label ?? normalized,
        tenant: patch?.tenant ?? "personal",
      });
    }
    this.touched();
  }

  removeAccount(email: string): void {
    const normalized = email.trim().toLowerCase();
    this.data.accounts = this.data.accounts.filter((a) => a.email !== normalized);
    this.touched();
  }

  setScheduler(name: keyof BrainSettings["schedulers"], enabled: boolean): void {
    this.data.schedulers[name] = enabled;
    this.touched();
  }

  flush(): void {
    this.persister.flushSync(this.data);
  }
}

export const brainSettingsManager = new BrainSettingsManager();
