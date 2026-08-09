import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { dayKeyInTz } from "./text.js";
import type { BrainActivityItem, ChatterSample } from "./types.js";

const execFileAsync = promisify(execFile);

const COMPOSE_SERVICE = "redis";
const CONTAINER_NAME = "claudemar-redis";
const WATCHDOG_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3000;
const COMPOSE_TIMEOUT_MS = 120_000;

export const KEYS = {
  events: "brain:events",
  ingestGroup: "brain:ingest",
  seen: (hash: string) => `brain:seen:${hash}`,
  cursorGmail: (email: string) => `brain:cursor:gmail:${email}`,
  cursorGmailWatermark: (email: string) => `brain:cursor:gmail:${email}:watermark`,
  cursorCalendar: (email: string) => `brain:cursor:calendar:${email}`,
  threadFile: "brain:thread:file",
  triagePending: "brain:triage:pending",
  triageAttempts: "brain:triage:attempts",
  triageInflight: "brain:triage:inflight",
  compilePending: "brain:compile:pending",
  compileAttempts: "brain:compile:attempts",
  compileInflight: "brain:compile:inflight",
  heartbeat: (name: string) => `brain:hb:${name}`,
  backfillState: "brain:backfill:state",
  backfillCancel: "brain:backfill:cancel",
  oauthState: (uuid: string) => `brain:oauth:state:${uuid}`,
  aliasCandidates: "brain:alias:candidates",
  indexFiles: "brain:index:files",
  indexLastFull: "brain:index:lastFull",
  alerts: "brain:alerts",
  alertsActive: "brain:alerts:active",
  distillState: "brain:distill:state",
  distillDone: "brain:distill:done",
  lintLastWeek: "brain:lint:lastWeek",
  gitGcLastMonth: "brain:git:gc:lastMonth",
  metrics: (day: string) => `brain:metrics:${day}`,
  chatterSamples: "brain:chatter:samples",
  activity: "brain:activity",
} as const;

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

export async function ensureConsumerGroup(): Promise<void> {
  const client = getRedis();
  await waitReady(client);
  try {
    await client.xgroup("CREATE", KEYS.events, KEYS.ingestGroup, "$", "MKSTREAM");
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

export async function markSeen(hash: string): Promise<boolean> {
  const result = await getRedis().set(KEYS.seen(hash), "1", "EX", SEEN_TTL_SECONDS, "NX");
  return result === "OK";
}

export async function clearSeen(hash: string): Promise<void> {
  await getRedis().del(KEYS.seen(hash));
}

export async function heartbeat(name: string): Promise<void> {
  await redisOrNull()?.set(KEYS.heartbeat(name), new Date().toISOString()).catch(() => {});
}

export async function getHeartbeats(names: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  try {
    const values = await getRedis().mget(names.map((n) => KEYS.heartbeat(n)));
    names.forEach((n, i) => {
      out[n] = values[i] ?? null;
    });
  } catch {
    for (const n of names) out[n] = null;
  }
  return out;
}

export async function queueDepths(): Promise<{
  events: number;
  eventsPending: number;
  triage: number;
  compile: number;
}> {
  const r = redisOrNull();
  if (!r) return { events: 0, eventsPending: 0, triage: 0, compile: 0 };
  try {
    const [events, pendingInfo, triage, compile] = await Promise.all([
      r.xlen(KEYS.events),
      r.xpending(KEYS.events, KEYS.ingestGroup) as Promise<[number, ...unknown[]] | null>,
      r.zcard(KEYS.triagePending),
      r.zcard(KEYS.compilePending),
    ]);
    const eventsPending = Array.isArray(pendingInfo) ? Number(pendingInfo[0] ?? 0) : 0;
    return { events, eventsPending, triage, compile };
  } catch {
    return { events: 0, eventsPending: 0, triage: 0, compile: 0 };
  }
}

export async function incrMetric(field: string, by = 1): Promise<void> {
  const key = KEYS.metrics(dayKeyInTz(new Date(), config.brainTz));
  const r = redisOrNull();
  if (!r) return;
  try {
    await r.hincrby(key, field, by);
    await r.expire(key, METRICS_TTL_SECONDS);
  } catch {}
}

export async function getMetrics(days: number): Promise<{ date: string; fields: Record<string, number> }[]> {
  const dates = Array.from({ length: days }, (_, i) =>
    dayKeyInTz(new Date(Date.now() - i * 24 * 60 * 60 * 1000), config.brainTz),
  );
  try {
    const pipeline = getRedis().pipeline();
    for (const date of dates) pipeline.hgetall(KEYS.metrics(date));
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

export async function pushChatterSample(sample: ChatterSample): Promise<void> {
  const r = redisOrNull();
  if (!r) return;
  try {
    await r.lpush(KEYS.chatterSamples, JSON.stringify(sample));
    await r.ltrim(KEYS.chatterSamples, 0, 199);
  } catch {}
}

export async function getChatterSamples(): Promise<ChatterSample[]> {
  try {
    const raw = await getRedis().lrange(KEYS.chatterSamples, 0, 199);
    return raw.map((s) => JSON.parse(s) as ChatterSample);
  } catch {
    return [];
  }
}

export async function pushActivity(item: BrainActivityItem): Promise<void> {
  const r = redisOrNull();
  if (!r) return;
  try {
    await r.lpush(KEYS.activity, JSON.stringify(item));
    await r.ltrim(KEYS.activity, 0, 99);
  } catch {}
}

export async function getActivity(limit = 30): Promise<BrainActivityItem[]> {
  try {
    const raw = await getRedis().lrange(KEYS.activity, 0, Math.max(0, limit - 1));
    return raw.map((s) => JSON.parse(s) as BrainActivityItem);
  } catch {
    return [];
  }
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
