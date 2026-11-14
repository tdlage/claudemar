import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { dayKeyInTz } from "./text.js";
import { perScope, type BrainScope } from "./scope.js";
import type { BrainActivityItem, ChatterSample } from "./types.js";

const execFileAsync = promisify(execFile);

const COMPOSE_SERVICE = "redis";
const CONTAINER_NAME = "claudemar-redis";
const WATCHDOG_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3000;
const COMPOSE_TIMEOUT_MS = 120_000;

export const INGEST_GROUP = "brain:ingest";

export const GLOBAL_KEYS = {
  oauthState: (uuid: string) => `brain:oauth:state:${uuid}`,
} as const;

function buildKeys(p: string) {
  return {
    events: `${p}events`,
    seen: (hash: string) => `${p}seen:${hash}`,
    cursorGmail: (email: string) => `${p}cursor:gmail:${email}`,
    cursorGmailWatermark: (email: string) => `${p}cursor:gmail:${email}:watermark`,
    cursorCalendar: (email: string) => `${p}cursor:calendar:${email}`,
    slackSync: (account: string) => `${p}slack:sync:${account}`,
    slackThreads: (account: string) => `${p}slack:threads:${account}`,
    threadFile: `${p}thread:file`,
    triagePending: `${p}triage:pending`,
    triageAttempts: `${p}triage:attempts`,
    triageInflight: `${p}triage:inflight`,
    compilePending: `${p}compile:pending`,
    compileAttempts: `${p}compile:attempts`,
    compileInflight: `${p}compile:inflight`,
    heartbeat: (name: string) => `${p}hb:${name}`,
    backfillState: `${p}backfill:state`,
    backfillCancel: `${p}backfill:cancel`,
    backfillDone: `${p}backfill:done`,
    aliasCandidates: `${p}alias:candidates`,
    indexFiles: `${p}index:files`,
    indexLastFull: `${p}index:lastFull`,
    indexSchema: `${p}index:schema`,
    alerts: `${p}alerts`,
    alertsActive: `${p}alerts:active`,
    distillState: `${p}distill:state`,
    distillDone: `${p}distill:done`,
    distillPending: `${p}distill:pending`,
    lintLastWeek: `${p}lint:lastWeek`,
    gitGcLastMonth: `${p}git:gc:lastMonth`,
    metrics: (day: string) => `${p}metrics:${day}`,
    chatterSamples: `${p}chatter:samples`,
    activity: `${p}activity`,
    cmExecCursor: `${p}cm:cursor:exec`,
    cmExecDone: `${p}cm:exec:done`,
    cmCardHashes: `${p}cm:cards`,
    cmCommitCursor: `${p}cm:cursor:commits`,
    cmOrphanCursor: `${p}cm:cursor:orphans`,
    cmTargetHashes: `${p}cm:targets`,
    cmDirtyTargets: `${p}cm:dirty`,
    cmGates: `${p}cm:gates`,
  } as const;
}

export type BrainKeys = ReturnType<typeof buildKeys>;

export const brainKeys = perScope((scope: BrainScope): BrainKeys => buildKeys(scope.keyPrefix));

const SEEN_TTL_SECONDS = 400 * 24 * 60 * 60;
const METRICS_TTL_SECONDS = 90 * 24 * 60 * 60;

let client: Redis | null = null;
let closed = false;

export function getRedis(): Redis {
  if (closed) throw new Error("Redis encerrado (shutdown em andamento)");
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => 2000,
    });
    client.on("error", () => {});
  }
  return client;
}

function redisOrNull(): Redis | null {
  try {
    return getRedis();
  } catch {
    return null;
  }
}

export function closeRedis(): void {
  closed = true;
  if (client) {
    client.disconnect();
    client = null;
  }
}

const READY_TIMEOUT_MS = 5000;

async function waitReady(client: Redis): Promise<void> {
  if (client.status === "ready") return;
  await new Promise<void>((done) => {
    const finish = (): void => {
      clearTimeout(timer);
      client.off("ready", finish);
      done();
    };
    const timer = setTimeout(finish, READY_TIMEOUT_MS);
    timer.unref();
    client.once("ready", finish);
  });
}

export async function ensureConsumerGroup(scope: BrainScope): Promise<void> {
  const client = getRedis();
  await waitReady(client);
  try {
    await client.xgroup("CREATE", brainKeys(scope).events, INGEST_GROUP, "$", "MKSTREAM");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BUSYGROUP")) throw err;
  }
}

export async function claimPending(pendingKey: string, inflightKey: string, member: string): Promise<void> {
  await getRedis().pipeline().zrem(pendingKey, member).zadd(inflightKey, Date.now(), member).exec();
}

export async function releaseInflight(inflightKey: string, member: string): Promise<void> {
  await getRedis().zrem(inflightKey, member).catch(() => {});
}

export async function requeuePending(pendingKey: string, member: string): Promise<void> {
  await getRedis().zadd(pendingKey, "NX", Date.now(), member).catch(() => {});
}

export async function recoverInflight(pendingKey: string, inflightKey: string, staleMs: number): Promise<void> {
  const redis = getRedis();
  const stale = await redis.zrangebyscore(inflightKey, "0", String(Date.now() - staleMs));
  if (stale.length === 0) return;
  const pipe = redis.pipeline();
  for (const member of stale) {
    pipe.zadd(pendingKey, "NX", Date.now(), member);
    pipe.zrem(inflightKey, member);
  }
  await pipe.exec();
}

export async function markSeen(scope: BrainScope, hash: string): Promise<boolean> {
  const result = await getRedis().set(brainKeys(scope).seen(hash), "1", "EX", SEEN_TTL_SECONDS, "NX");
  return result === "OK";
}

export async function clearSeen(scope: BrainScope, hash: string): Promise<void> {
  await getRedis().del(brainKeys(scope).seen(hash));
}

export async function heartbeat(scope: BrainScope, name: string): Promise<void> {
  await redisOrNull()?.set(brainKeys(scope).heartbeat(name), new Date().toISOString()).catch(() => {});
}

export async function getHeartbeats(scope: BrainScope, names: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  try {
    const values = await getRedis().mget(names.map((n) => brainKeys(scope).heartbeat(n)));
    names.forEach((n, i) => {
      out[n] = values[i] ?? null;
    });
  } catch {
    for (const n of names) out[n] = null;
  }
  return out;
}

export async function queueDepths(scope: BrainScope): Promise<{
  events: number;
  eventsPending: number;
  triage: number;
  compile: number;
}> {
  const r = redisOrNull();
  if (!r) return { events: 0, eventsPending: 0, triage: 0, compile: 0 };
  const keys = brainKeys(scope);
  try {
    const [events, pendingInfo, triage, compile] = await Promise.all([
      r.xlen(keys.events),
      r.xpending(keys.events, INGEST_GROUP) as Promise<[number, ...unknown[]] | null>,
      r.zcard(keys.triagePending),
      r.zcard(keys.compilePending),
    ]);
    const eventsPending = Array.isArray(pendingInfo) ? Number(pendingInfo[0] ?? 0) : 0;
    return { events, eventsPending, triage, compile };
  } catch {
    return { events: 0, eventsPending: 0, triage: 0, compile: 0 };
  }
}

export async function incrMetric(scope: BrainScope, field: string, by = 1): Promise<void> {
  const key = brainKeys(scope).metrics(dayKeyInTz(new Date(), config.brainTz));
  const r = redisOrNull();
  if (!r) return;
  try {
    await r.hincrby(key, field, by);
    await r.expire(key, METRICS_TTL_SECONDS);
  } catch {}
}

export async function getMetrics(scope: BrainScope, days: number): Promise<{ date: string; fields: Record<string, number> }[]> {
  const dates = Array.from({ length: days }, (_, i) =>
    dayKeyInTz(new Date(Date.now() - i * 24 * 60 * 60 * 1000), config.brainTz),
  );
  try {
    const pipeline = getRedis().pipeline();
    for (const date of dates) pipeline.hgetall(brainKeys(scope).metrics(date));
    const replies = (await pipeline.exec()) ?? [];
    return dates.map((date, i) => {
      const [err, raw] = replies[i] ?? [null, {}];
      const fields: Record<string, number> = {};
      if (!err && raw) {
        for (const [k, v] of Object.entries(raw as Record<string, string>)) fields[k] = Number(v) || 0;
      }
      return { date, fields };
    });
  } catch {
    return dates.map((date) => ({ date, fields: {} }));
  }
}

export async function pushChatterSample(scope: BrainScope, sample: ChatterSample): Promise<void> {
  const r = redisOrNull();
  if (!r) return;
  const key = brainKeys(scope).chatterSamples;
  try {
    await r.lpush(key, JSON.stringify(sample));
    await r.ltrim(key, 0, 199);
  } catch {}
}

export async function getChatterSamples(scope: BrainScope): Promise<ChatterSample[]> {
  try {
    const raw = await getRedis().lrange(brainKeys(scope).chatterSamples, 0, 199);
    return raw.map((s) => JSON.parse(s) as ChatterSample);
  } catch {
    return [];
  }
}

export async function pushActivity(scope: BrainScope, item: BrainActivityItem): Promise<void> {
  const r = redisOrNull();
  if (!r) return;
  const key = brainKeys(scope).activity;
  try {
    await r.lpush(key, JSON.stringify(item));
    await r.ltrim(key, 0, 99);
  } catch {}
}

export async function getActivity(scope: BrainScope, limit = 30): Promise<BrainActivityItem[]> {
  try {
    const raw = await getRedis().lrange(brainKeys(scope).activity, 0, Math.max(0, limit - 1));
    return raw.map((s) => JSON.parse(s) as BrainActivityItem);
  } catch {
    return [];
  }
}

const DELETE_SCAN_COUNT = 500;

/** Apaga todo o keyspace de um brain de usuário; o do admin nunca é apagado por aqui. */
export async function deleteBrainKeys(scope: BrainScope): Promise<number> {
  if (scope.isAdmin) throw new Error("o keyspace do brain do admin não é removível");
  const redis = getRedis();
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${scope.keyPrefix}*`, "COUNT", DELETE_SCAN_COUNT);
    cursor = next;
    if (keys.length > 0) removed += await redis.unlink(...keys);
  } while (cursor !== "0");
  return removed;
}

function parseEndpoint(url: string): { host: string; port: number } {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port ? Number(u.port) : 6379 };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
}

class RedisWatchdog {
  private endpoint = parseEndpoint(config.redisUrl);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ensuring = false;
  lastError = "";
  reachable = false;

  async start(): Promise<void> {
    await this.tick();
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), WATCHDOG_INTERVAL_MS);
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    this.reachable = await this.isReachable();
    if (!this.reachable) {
      console.warn("[brain] Redis inacessível — reerguendo container");
      await this.ensureUp();
      this.reachable = await this.isReachable();
    }
  }

  private async ensureUp(): Promise<void> {
    if (this.ensuring) return;
    this.ensuring = true;
    try {
      await execFileAsync("docker", ["compose", "up", "-d", COMPOSE_SERVICE], {
        cwd: config.installDir,
        timeout: COMPOSE_TIMEOUT_MS,
      });
      this.lastError = "";
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[brain] Falha ao subir o ${CONTAINER_NAME}:`, this.lastError);
    } finally {
      this.ensuring = false;
    }
  }

  private isReachable(): Promise<boolean> {
    return new Promise((resolveReachable) => {
      const socket = connect({ host: this.endpoint.host, port: this.endpoint.port });
      const finish = (ok: boolean): void => {
        socket.destroy();
        resolveReachable(ok);
      };
      socket.setTimeout(HEALTH_TIMEOUT_MS);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }
}

export const redisWatchdog = new RedisWatchdog();
