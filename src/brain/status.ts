import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { brainKeys, getMetrics, getRedis, queueDepths, redisWatchdog } from "./redis.js";
import { brainSchedulers } from "./schedulers.js";
import { repoInfo } from "./git.js";
import { getAccountsStatus, googleConfigured } from "./connectors/google-auth.js";
import { whatsappConnectionIssues } from "./connectors/whatsapp.js";
import { slackConnectionIssues } from "./connectors/slack.js";
import { evaluateAlerts } from "./freshness.js";
import { quarantineCount } from "./quarantine.js";
import { brainExists, perScope, type BrainScope } from "./scope.js";
import type { BackfillState, BrainConnectionIssue, BrainStatus, BrainTechnicalStatus } from "./types.js";

async function countMdFiles(dir: string): Promise<number> {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) stack.push(resolve(current, entry.name));
      else if (entry.name.endsWith(".md")) count += 1;
    }
  }
  return count;
}

interface Counts {
  rawThreads: number;
  wikiPages: number;
}

interface StatusCache {
  counts: (Counts & { at: number }) | null;
  countsInFlight: Promise<Counts> | null;
  git: { info: { head: string; dirty: number }; at: number } | null;
}

const statusCache = perScope((): StatusCache => ({ counts: null, countsInFlight: null, git: null }));
const COUNTS_TTL_MS = 120_000;
const GIT_TTL_MS = 60_000;

async function getCounts(scope: BrainScope): Promise<Counts> {
  const cache = statusCache(scope);
  if (cache.counts && Date.now() - cache.counts.at < COUNTS_TTL_MS) {
    return { rawThreads: cache.counts.rawThreads, wikiPages: cache.counts.wikiPages };
  }
  if (!cache.countsInFlight) {
    cache.countsInFlight = (async () => {
      const counts = { rawThreads: await countMdFiles(scope.rawDir), wikiPages: await countMdFiles(scope.wikiDir) };
      cache.counts = { ...counts, at: Date.now() };
      cache.countsInFlight = null;
      return counts;
    })();
  }
  if (cache.counts) return { rawThreads: cache.counts.rawThreads, wikiPages: cache.counts.wikiPages };
  return cache.countsInFlight;
}

async function getGitInfo(scope: BrainScope): Promise<{ head: string; dirty: number }> {
  const cache = statusCache(scope);
  if (cache.git && Date.now() - cache.git.at < GIT_TTL_MS) return cache.git.info;
  const info = await repoInfo(scope).catch(() => ({ head: "", dirty: 0 }));
  cache.git = { info, at: Date.now() };
  return info;
}

export function idleBackfillState(): BackfillState {
  return {
    status: "idle",
    phase: null,
    accounts: [],
    claudemar: false,
    monthsRaw: 0,
    monthsCompile: 0,
    startedAt: null,
    finishedAt: null,
    error: "",
    progress: { currentAccount: null, currentMonth: null, processed: 0, total: 0, batchId: null, detail: "" },
  };
}

export async function getBackfillState(scope: BrainScope): Promise<BackfillState> {
  try {
    const raw = await getRedis().get(brainKeys(scope).backfillState);
    if (!raw) return idleBackfillState();
    return { ...idleBackfillState(), ...(JSON.parse(raw) as Partial<BackfillState>) };
  } catch {
    return idleBackfillState();
  }
}

/** Conexões que só o próprio dono consegue consertar (reautorizar uma conta, reescanear um QR). */
export function connectionIssues(scope: BrainScope): BrainConnectionIssue[] {
  const issues: BrainConnectionIssue[] = [];
  if (googleConfigured()) {
    for (const account of getAccountsStatus(scope)) {
      if (account.reauthRequired) {
        issues.push({ connector: "google", account: account.email, message: "a autorização expirou — reconecte a conta Google" });
      } else if (!account.connected) {
        issues.push({ connector: "google", account: account.email, message: "conta Google desconectada — conecte de novo" });
      }
    }
  }
  issues.push(...whatsappConnectionIssues(scope), ...slackConnectionIssues(scope));
  return issues;
}

export async function getBrainStatus(scope: BrainScope): Promise<BrainStatus> {
  const [schedulers, queues, metrics, quarantine, git, backfill, counts] = await Promise.all([
    brainSchedulers.statuses(scope),
    queueDepths(scope),
    getMetrics(scope, 7),
    quarantineCount(scope),
    getGitInfo(scope),
    getBackfillState(scope),
    getCounts(scope),
  ]);

  return {
    redis: { reachable: redisWatchdog.reachable, lastError: redisWatchdog.lastError },
    google: { configured: googleConfigured(), accounts: getAccountsStatus(scope) },
    schedulers,
    queues,
    metrics,
    quarantineCount: quarantine,
    counts,
    git,
    backfill,
    alerts: evaluateAlerts(scope, { statuses: schedulers, queues, metrics }),
    connections: connectionIssues(scope),
  };
}

/**
 * O que o admin vê do brain de outro usuário: saúde e números. Rótulos e contextos das contas
 * ficam de fora — nomes de contexto já dizem com quem e com o que o usuário trabalha.
 */
export async function getTechnicalStatus(scope: BrainScope): Promise<BrainTechnicalStatus> {
  if (!brainExists(scope)) return { initialized: false, status: null };
  const status = await getBrainStatus(scope);
  return {
    initialized: true,
    status: {
      ...status,
      google: {
        configured: status.google.configured,
        accounts: status.google.accounts.map((account) => ({ ...account, label: account.email, tenant: "" })),
      },
    },
  };
}
