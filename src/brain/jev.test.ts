import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-jev-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { lowValueVerdict, selectedIndices } = await import("./jev.js");
const { brainSettingsManager } = await import("./settings.js");

const settings = { compile: { minRelevance: 2, maxSectionChars: 4000, contextPages: 6, batchSize: 20, maxPerTick: 100 }, jev: { triagePrefilter: true, triageMinConfidence: 0.8, selector: true, selectorThreshold: 0.5 } };

function answers(score: number, confidence: number, flags: { commitment?: number; deadline?: number; action?: number; pii?: number } = {}) {
  return {
    relevance: { type: "score" as const, score, confidence, probabilities: {}, legend: {} },
    contains_pii: { type: "noul" as const, noul: flags.pii ?? 0 },
    has_commitment: { type: "noul" as const, noul: flags.commitment ?? 0 },
    has_deadline: { type: "noul" as const, noul: flags.deadline ?? 0 },
    action_required: { type: "noul" as const, noul: flags.action ?? 0 },
  };
}

test("pré-filtro Jev dispensa o LLM só para threads de baixo valor com confiança alta", () => {
  assert.deepEqual(lowValueVerdict(answers(0.2, 0.95), "jev-1.13.0", settings), { relevance: 0, confidence: 0.95, containsPii: 0, model: "jev-1.13.0" });
  assert.equal(lowValueVerdict(answers(1.1, 0.9, { pii: 0.4 }), "m", settings)?.containsPii, 1);
  assert.equal(lowValueVerdict(answers(1.6, 0.95), "m", settings), null);
  assert.equal(lowValueVerdict(answers(0.4, 0.6), "m", settings), null);
  assert.equal(lowValueVerdict(answers(0.3, 0.95, { deadline: 0.7 }), "m", settings), null);
  assert.equal(lowValueVerdict(answers(0.3, 0.95, { action: 0.5 }), "m", settings), null);
  assert.equal(lowValueVerdict(answers(1, 0.95), "m", { ...settings, compile: { ...settings.compile, minRelevance: 1 } }), null);
});

test("seletor Jev mantém a ordem do ranking, aplica o limiar e o limite", () => {
  assert.deepEqual(selectedIndices([0.9, 0.2, 0.7, undefined, 0.55], 0.5, 10), [0, 2, 4]);
  assert.deepEqual(selectedIndices([0.9, 0.8, 0.7], 0.5, 2), [0, 1]);
  assert.deepEqual(selectedIndices([0.1, 0.2], 0.5, 5), []);
});

test("settings do Jev: defaults, patch parcial e saneamento", () => {
  assert.deepEqual(brainSettingsManager.get().jev, settings.jev);
  const updated = brainSettingsManager.update({ jev: { selector: false, triageMinConfidence: 0.9, selectorThreshold: 3 } });
  assert.deepEqual(updated.jev, { triagePrefilter: true, triageMinConfidence: 0.9, selector: false, selectorThreshold: 0.5 });
});
