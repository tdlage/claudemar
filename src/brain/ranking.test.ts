import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-ranking-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const {
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_TYPE_WEIGHTS,
  businessScore,
  passesThreshold,
  recencyWeight,
  utilityWeight,
} = await import("./ranking.js");
const { brainSettingsManager } = await import("./settings.js");
type Rankable = import("./ranking.js").Rankable;

const NOW = Date.parse("2026-08-09T12:00:00Z");
const DAY = 86_400_000;

function payload(overrides: Partial<Rankable>): Rankable {
  return {
    type: "topic",
    status: "active",
    pinned: false,
    salience: 0,
    updatedAt: new Date(NOW).toISOString(),
    retrievalCount: 0,
    helpfulCount: 0,
    ...overrides,
  };
}

test("pesos de tipo padrão seguem a ordem do §9.3", () => {
  assert.equal(DEFAULT_TYPE_WEIGHTS.lesson, 1.35);
  assert.equal(DEFAULT_TYPE_WEIGHTS.procedure, 1.35);
  assert.equal(DEFAULT_TYPE_WEIGHTS.person, 1.3);
  assert.equal(DEFAULT_TYPE_WEIGHTS.org, 1.3);
  assert.equal(DEFAULT_TYPE_WEIGHTS.decision, 1.25);
  assert.equal(DEFAULT_TYPE_WEIGHTS.project, 1.2);
  assert.equal(DEFAULT_TYPE_WEIGHTS.topic, 1.0);
  assert.equal(DEFAULT_TYPE_WEIGHTS.thread, 0.85);
});

test("recência: thread decai com meia-vida de 180 dias", () => {
  const half = DEFAULT_HALF_LIFE_DAYS;
  const at = (days: number) => new Date(NOW - days * DAY).toISOString();
  assert.ok(Math.abs(recencyWeight(payload({ type: "thread", updatedAt: at(180) }), half, NOW) - 0.5) < 1e-9);
  assert.ok(Math.abs(recencyWeight(payload({ type: "thread", updatedAt: at(360) }), half, NOW) - 0.25) < 1e-9);
  assert.equal(recencyWeight(payload({ type: "thread", updatedAt: at(0) }), half, NOW), 1);
  assert.equal(recencyWeight(payload({ type: "person", updatedAt: at(365) }), half, NOW), 0.5);
});

test("recência: lição não decai, projeto ativo não decai, dormente decai", () => {
  const old = new Date(NOW - 3650 * DAY).toISOString();
  assert.equal(recencyWeight(payload({ type: "lesson", updatedAt: old }), DEFAULT_HALF_LIFE_DAYS, NOW), 1);
  assert.equal(recencyWeight(payload({ type: "decision", updatedAt: old }), DEFAULT_HALF_LIFE_DAYS, NOW), 1);
  assert.equal(
    recencyWeight(payload({ type: "project", status: "active", updatedAt: old }), DEFAULT_HALF_LIFE_DAYS, NOW),
    1,
  );
  const dormant = recencyWeight(
    payload({ type: "project", status: "dormant", updatedAt: new Date(NOW - 365 * DAY).toISOString() }),
    DEFAULT_HALF_LIFE_DAYS,
    NOW,
  );
  assert.ok(Math.abs(dormant - 0.5) < 1e-9);
  assert.equal(
    recencyWeight(payload({ type: "thread", updatedAt: "data-inválida" }), DEFAULT_HALF_LIFE_DAYS, NOW),
    1,
  );
});

test("utilidade começa neutra e aprende com o feedback", () => {
  assert.equal(utilityWeight(payload({})), 1);
  const semAjuda = utilityWeight(payload({ retrievalCount: 20, helpfulCount: 0 }));
  assert.ok(Math.abs(semAjuda - (0.5 + 1 / 22)) < 1e-9);
  const ajudou = utilityWeight(payload({ retrievalCount: 20, helpfulCount: 5 }));
  assert.ok(ajudou > semAjuda);
  assert.ok(ajudou <= 1.5);
});

test("score de negócio compõe rerank × recência × tipo × saliência × utilidade", () => {
  const settings = brainSettingsManager.get().retrieval;
  const recent = new Date(NOW).toISOString();
  const lesson = businessScore(
    0.8,
    payload({ type: "lesson", updatedAt: recent, salience: 1 }),
    settings,
    NOW,
  );
  const thread = businessScore(
    0.8,
    payload({ type: "thread", updatedAt: recent, salience: 0 }),
    settings,
    NOW,
  );
  assert.ok(lesson > thread);
  assert.ok(Math.abs(thread - 0.8 * 0.85) < 1e-9);
  assert.ok(Math.abs(lesson - 0.8 * 1.35 * 1.1) < 1e-9);

  const threadAntiga = businessScore(
    0.8,
    payload({ type: "thread", updatedAt: new Date(NOW - 180 * DAY).toISOString() }),
    settings,
    NOW,
  );
  assert.ok(Math.abs(threadAntiga - thread * 0.5) < 1e-9);
});

test("corte por limiar: pinado nunca é removido, shadow não corta", () => {
  assert.equal(passesThreshold(0.1, false, 0), true);
  assert.equal(passesThreshold(0.1, false, 0.5), false);
  assert.equal(passesThreshold(0.6, false, 0.5), true);
  assert.equal(passesThreshold(null, false, 0.5), true);
  assert.equal(passesThreshold(0.01, true, 0.9), true);
});

test("settings de retrieval: defaults, patch parcial e saneamento", () => {
  const before = brainSettingsManager.get().retrieval;
  assert.equal(before.rerankMinScore, 0);
  assert.equal(before.businessRanking, false);
  assert.equal(before.typeWeights.lesson, 1.35);
  assert.equal(before.halfLifeDays.thread, 180);
  assert.equal(before.halfLifeDays.lesson, null);
  assert.equal(before.salienceBonus, 0.1);

  const updated = brainSettingsManager.update({
    retrieval: {
      businessRanking: true,
      rerankMinScore: 0.42,
      typeWeights: { thread: 0.9, bogus: 5, lesson: -1 },
      halfLifeDays: { lesson: 30, thread: null },
    },
  }).retrieval;

  assert.equal(updated.businessRanking, true);
  assert.equal(updated.rerankMinScore, 0.42);
  assert.equal(updated.typeWeights.thread, 0.9);
  assert.equal(updated.typeWeights.lesson, 1.35);
  assert.equal(updated.typeWeights.person, 1.3);
  assert.equal(updated.halfLifeDays.lesson, 30);
  assert.equal(updated.halfLifeDays.thread, null);
  assert.equal(updated.halfLifeDays.person, 365);
});
