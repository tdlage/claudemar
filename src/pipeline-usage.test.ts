import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateCardUsage, EMPTY_CARD_USAGE, type UsageRunInput } from "./pipeline-usage.js";

function run(partial: Partial<UsageRunInput>): UsageRunInput {
  return { status: "passed", costUsd: 0, totalTokens: 0, contextPct: 0, startedAt: 0, ...partial };
}

test("sem runs retorna zeros", () => {
  assert.deepEqual(aggregateCardUsage([]), EMPTY_CARD_USAGE);
});

test("soma custo e tokens entre as runs do card", () => {
  const usage = aggregateCardUsage([
    run({ costUsd: 0.12, totalTokens: 1000, contextPct: 10, startedAt: 1 }),
    run({ costUsd: 0.30, totalTokens: 2500, contextPct: 40, startedAt: 2 }),
  ]);
  assert.equal(Number(usage.totalCostUsd.toFixed(2)), 0.42);
  assert.equal(usage.totalTokens, 3500);
});

test("contextPct vem da última run finalizada quando nenhuma está ativa", () => {
  const usage = aggregateCardUsage([
    run({ contextPct: 25, startedAt: 10 }),
    run({ contextPct: 63, startedAt: 20 }),
    run({ contextPct: 50, startedAt: 15 }),
  ]);
  assert.equal(usage.contextPct, 63);
});

test("contextPct vem da run ativa, ignorando finalizadas mais recentes", () => {
  const usage = aggregateCardUsage([
    run({ status: "passed", contextPct: 90, startedAt: 30 }),
    run({ status: "running", contextPct: 45, startedAt: 20 }),
  ]);
  assert.equal(usage.contextPct, 45);
});

test("com múltiplas runs ativas usa a mais recente", () => {
  const usage = aggregateCardUsage([
    run({ status: "running", contextPct: 30, startedAt: 5 }),
    run({ status: "running", contextPct: 70, startedAt: 8 }),
  ]);
  assert.equal(usage.contextPct, 70);
});

test("contexto não é somado entre etapas", () => {
  const usage = aggregateCardUsage([
    run({ contextPct: 40, startedAt: 1 }),
    run({ contextPct: 55, startedAt: 2 }),
  ]);
  assert.ok(usage.contextPct <= 100);
  assert.equal(usage.contextPct, 55);
});
