import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AlertInputs } from "./freshness.js";
import type { SchedulerStatus } from "./types.js";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-freshness-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { evaluateAlerts } = await import("./freshness.js");

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

function gmail(lastHeartbeat: string | null): SchedulerStatus {
  return { name: "gmail", enabled: true, inFlight: false, lastHeartbeat, lastError: "", disabledReason: null };
}

const idleQueues = { events: 0, eventsPending: 0, triage: 0, compile: 0 };
const withEmail: AlertInputs["metrics"] = [{ date: "hoje", fields: { "events:email": 3 } }, { date: "ontem", fields: {} }];

test("alertas refletem o estado recebido: heartbeat recente e eventos recentes não alertam", () => {
  assert.deepEqual(evaluateAlerts({ statuses: [gmail(minutesAgo(1))], queues: idleQueues, metrics: withEmail }), []);
});

test("heartbeat vencido, fila acima do limite e conector mudo geram alerta", () => {
  const stale = minutesAgo(60);
  const alerts = evaluateAlerts({
    statuses: [gmail(stale)],
    queues: { ...idleQueues, triage: 501 },
    metrics: [{ date: "hoje", fields: {} }, { date: "ontem", fields: {} }],
  });
  assert.deepEqual(alerts, [
    `scheduler gmail sem heartbeat desde ${stale}`,
    "fila de triagem com 501 thread(s) — acima do limite de 500",
    "conector email ligado mas sem nenhum evento nos últimos 2 dias",
  ]);
});

test("conector mudo considera só a janela de 2 dias, mesmo recebendo mais dias de métricas", () => {
  const metrics: AlertInputs["metrics"] = [{ date: "hoje", fields: {} }, { date: "ontem", fields: {} }, { date: "anteontem", fields: { "events:email": 9 } }];
  const alerts = evaluateAlerts({ statuses: [gmail(minutesAgo(1))], queues: idleQueues, metrics });
  assert.deepEqual(alerts, ["conector email ligado mas sem nenhum evento nos últimos 2 dias"]);
});
