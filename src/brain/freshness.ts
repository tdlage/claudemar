import { executeSpawn } from "../executor.js";
import { brainKeys, getMetrics, getRedis, queueDepths } from "./redis.js";
import { brainSchedulers } from "./schedulers.js";
import { emitActivity } from "./events.js";
import type { BrainScope } from "./scope.js";
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

export function evaluateAlerts(scope: BrainScope, { statuses, queues, metrics }: AlertInputs): string[] {
  const alerts: string[] = [];

  for (const status of statuses) {
    if (status.name === "freshness") continue;
    if (!status.enabled || status.disabledReason || status.inFlight) continue;
    if (brainSchedulers.heartbeatStale(scope, status.name, status.lastHeartbeat)) {
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

async function computeAlerts(scope: BrainScope): Promise<string[]> {
  const [statuses, queues, metrics] = await Promise.all([
    brainSchedulers.statuses(scope),
    queueDepths(scope),
    getMetrics(scope, MUTE_WINDOW_DAYS),
  ]);
  return evaluateAlerts(scope, { statuses, queues, metrics });
}

export async function freshnessTick(scope: BrainScope): Promise<string> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const current = await computeAlerts(scope);

  let previous: string[] = [];
  try {
    const raw = await redis.get(keys.alertsActive);
    if (raw) previous = JSON.parse(raw) as string[];
  } catch {}

  const previousSet = new Set(previous);
  const fresh = current.filter((a) => !previousSet.has(a));
  if (fresh.length > 0) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    for (const alert of fresh) {
      await redis.lpush(keys.alerts, `[${stamp}] ${alert}`).catch(() => {});
      emitActivity(scope, { kind: "alert", label: alert });
    }
    await redis.ltrim(keys.alerts, 0, 49).catch(() => {});
  }
  await redis.set(keys.alertsActive, JSON.stringify(current)).catch(() => {});

  const month = new Date().toISOString().slice(0, 7);
  const lastGc = await redis.get(keys.gitGcLastMonth).catch(() => null);
  if (lastGc !== month) {
    await redis.set(keys.gitGcLastMonth, month).catch(() => {});
    const gc = await executeSpawn("git", ["gc", "--quiet", "--auto"], scope.root, 300_000).catch(() => null);
    if (!gc || gc.exitCode !== 0) await redis.del(keys.gitGcLastMonth).catch(() => {});
  }

  return `${current.length} alerta(s) ativo(s)`;
}

brainSchedulers.register({
  name: "freshness",
  cadenceMs: (s) => s.cadences.freshnessMs,
  initialDelayMs: STARTUP_DELAY_MS,
  run: freshnessTick,
});
