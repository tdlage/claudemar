import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getMetrics, getRedis, KEYS, queueDepths, redisWatchdog } from "./redis.js";
import { brainSchedulers } from "./schedulers.js";
import { rawDir, wikiDir } from "./paths.js";
import { repoInfo } from "./git.js";
import { getAccountsStatus, googleConfigured } from "./connectors/google-auth.js";
import { getActiveAlerts } from "./freshness.js";
import { quarantineCount } from "./quarantine.js";
import type { BackfillState, BrainStatus } from "./types.js";

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

let countsCache: { rawThreads: number; wikiPages: number; at: number } | null = null;
let countsInFlight: Promise<{ rawThreads: number; wikiPages: number }> | null = null;
let gitCache: { info: { head: string; dirty: number }; at: number } | null = null;
const COUNTS_TTL_MS = 120_000;
const GIT_TTL_MS = 60_000;

async function getCounts(): Promise<{ rawThreads: number; wikiPages: number }> {
  if (countsCache && Date.now() - countsCache.at < COUNTS_TTL_MS) {
    return { rawThreads: countsCache.rawThreads, wikiPages: countsCache.wikiPages };
  }
  if (!countsInFlight) {
    countsInFlight = (async () => {
      const counts = { rawThreads: await countMdFiles(rawDir), wikiPages: await countMdFiles(wikiDir) };
      countsCache = { ...counts, at: Date.now() };
      countsInFlight = null;
      return counts;
    })();
  }
  if (countsCache) return { rawThreads: countsCache.rawThreads, wikiPages: countsCache.wikiPages };
  return countsInFlight;
}

async function getGitInfo(): Promise<{ head: string; dirty: number }> {
  if (gitCache && Date.now() - gitCache.at < GIT_TTL_MS) return gitCache.info;
  const info = await repoInfo().catch(() => ({ head: "", dirty: 0 }));
  gitCache = { info, at: Date.now() };
  return info;
}

export function idleBackfillState(): BackfillState {
  return {
    status: "idle",
    phase: null,
    accounts: [],
    monthsRaw: 0,
    monthsCompile: 0,
    startedAt: null,
    finishedAt: null,
    error: "",
    progress: { currentAccount: null, currentMonth: null, processed: 0, total: 0, batchId: null, detail: "" },
  };
}

export async function getBackfillState(): Promise<BackfillState> {
  try {
    const raw = await getRedis().get(KEYS.backfillState);
    if (!raw) return idleBackfillState();
    return JSON.parse(raw) as BackfillState;
  } catch {
    return idleBackfillState();
  }
}

export async function getBrainStatus(): Promise<BrainStatus> {
  const [schedulers, queues, metrics, quarantine, git, backfill, alerts, counts] = await Promise.all([
    brainSchedulers.statuses(),
    queueDepths(),
    getMetrics(7),
    quarantineCount(),
    getGitInfo(),
    getBackfillState(),
    getActiveAlerts(),
    getCounts(),
  ]);

  return {
    redis: { reachable: redisWatchdog.reachable, lastError: redisWatchdog.lastError },
    google: { configured: googleConfigured(), accounts: getAccountsStatus() },
    schedulers,
    queues,
    metrics,
    quarantineCount: quarantine,
    counts,
    git,
    backfill,
    alerts,
  };
}
