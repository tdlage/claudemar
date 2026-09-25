import { executeSpawn } from "../executor.js";
import { getMetrics, getRedis, KEYS, queueDepths } from "./redis.js";
import { brainRoot } from "./paths.js";
import { brainSchedulers } from "./schedulers.js";
import { emitActivity } from "./events.js";
import type { BrainChannel, BrainSchedulerName, SchedulerStatus } from "./types.js";

const QUEUE_LIMITS = { triage: 500, compile: 500, eventsPending: 1000 } as const;
const MUTE_PAIRS: [BrainSchedulerName, BrainChannel][] = [
  ["gmail", "email"],
  ["calendar", "calendar"],
  ["whatsapp", "whatsapp"],
  ["slack", "slack"],
];

const MUTE_WINDOW_DAYS = 2;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

export interface AlertInputs {
  statuses: SchedulerStatus[];
  queues: Awaited<ReturnType<typeof queueDepths>>;
  metrics: Awaited<ReturnType<typeof getMetrics>>;
}

export function evaluateAlerts({ statuses, queues, metrics }: AlertInputs): string[] {
  const alerts: string[] = [];

  for (const status of statuses) {
    if (status.name === "freshness") continue;
    if (!status.enabled || status.disabledReason || status.inFlight) continue;
    if (brainSchedulers.heartbeatStale(status.name, status.lastHeartbeat)) {
      alerts.push(
        `scheduler ${status.name} sem heartbeat desde ${status.lastHeartbeat ?? "o início do processo"}`,
      );
    }
  }

  if (queues.triage > QUEUE_LIMITS.triage) {
    alerts.push(`fila de triagem com ${queues.triage} thread(s) — acima do limite de ${QUEUE_LIMITS.triage}`);
  }
  if (queues.compile > QUEUE_LIMITS.compile) {
    alerts.push(`fila de compilação com ${queues.compile} thread(s) — acima do limite de ${QUEUE_LIMITS.compile}`);
  }
  if (queues.eventsPending > QUEUE_LIMITS.eventsPending) {
    alerts.push(
      `stream de eventos com ${queues.eventsPending} pendente(s) sem ack — ingestão pode estar travada`,
    );
  }

  const recent = metrics.slice(0, MUTE_WINDOW_DAYS);
  const byScheduler = new Map(statuses.map((s) => [s.name, s]));
  for (const [scheduler, channel] of MUTE_PAIRS) {
    const status = byScheduler.get(scheduler);
    if (!status?.enabled || status.disabledReason) continue;
    const emitted = recent.reduce((acc, day) => acc + (day.fields[`events:${channel}`] ?? 0), 0);
    if (emitted === 0) {
      alerts.push(`conector ${channel} ligado mas sem nenhum evento nos últimos ${MUTE_WINDOW_DAYS} dias`);
    }
  }

  return alerts;
}

async function computeAlerts(): Promise<string[]> {
  const [statuses, queues, metrics] = await Promise.all([
    brainSchedulers.statuses(),
    queueDepths(),
    getMetrics(MUTE_WINDOW_DAYS),
  ]);
  return evaluateAlerts({ statuses, queues, metrics });
}

export async function freshnessTick(): Promise<string> {
  const redis = getRedis();
  const current = await computeAlerts();

  let previous: string[] = [];
  try {
    const raw = await redis.get(KEYS.alertsActive);
    if (raw) previous = JSON.parse(raw) as string[];
  } catch {}

  const previousSet = new Set(previous);
  const fresh = current.filter((a) => !previousSet.has(a));
  if (fresh.length > 0) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    for (const alert of fresh) {
      await redis.lpush(KEYS.alerts, `[${stamp}] ${alert}`).catch(() => {});
      emitActivity({ kind: "alert", label: alert });
    }
    await redis.ltrim(KEYS.alerts, 0, 49).catch(() => {});
  }
  await redis.set(KEYS.alertsActive, JSON.stringify(current)).catch(() => {});

  const month = new Date().toISOString().slice(0, 7);
  const lastGc = await redis.get(KEYS.gitGcLastMonth).catch(() => null);
  if (lastGc !== month) {
    await redis.set(KEYS.gitGcLastMonth, month).catch(() => {});
    const gc = await executeSpawn("git", ["gc", "--quiet", "--auto"], brainRoot, 300_000).catch(() => null);
    if (!gc || gc.exitCode !== 0) await redis.del(KEYS.gitGcLastMonth).catch(() => {});
  }

  return `${current.length} alerta(s) ativo(s)`;
}

brainSchedulers.register({
  name: "freshness",
  cadenceMs: (s) => s.cadences.freshnessMs,
  initialDelayMs: STARTUP_DELAY_MS,
  run: freshnessTick,
});
