import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_ORDER,
  SKIPPABLE_STAGES,
  isSkippable,
  sanitizeSkippedStages,
  validateSkippedStages,
  firstActiveStageIndex,
  type PipelineStage,
} from "./pipeline-migration.js";

function nextActive(stage: PipelineStage, skipped: PipelineStage[]): PipelineStage | null {
  const i = firstActiveStageIndex(STAGE_ORDER.indexOf(stage) + 1, new Set(skipped));
  return i === -1 ? null : STAGE_ORDER[i];
}

function firstActive(skipped: PipelineStage[]): PipelineStage | null {
  const i = firstActiveStageIndex(0, new Set(skipped));
  return i === -1 ? null : STAGE_ORDER[i];
}

test("SKIPPABLE_STAGES não inclui implementation, intake nem monitor", () => {
  assert.deepEqual(SKIPPABLE_STAGES, ["requirement", "plan", "code_review", "e2e", "pull_request"]);
  assert.equal(isSkippable("implementation"), false);
  assert.equal(isSkippable("intake"), false);
  assert.equal(isSkippable("monitor"), false);
  assert.equal(isSkippable("requirement"), true);
});

test("sem skip, firstActiveStageIndex(idx+1) reproduz a ordem atual (sem regressão)", () => {
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const expected = STAGE_ORDER[i + 1] ?? null;
    assert.equal(nextActive(STAGE_ORDER[i], []), expected);
  }
});

test("salta uma etapa pulada", () => {
  assert.equal(nextActive("requirement", ["plan"]), "implementation");
  assert.equal(nextActive("implementation", ["code_review"]), "e2e");
});

test("salta etapas puladas consecutivas de uma vez", () => {
  assert.equal(nextActive("implementation", ["code_review", "e2e"]), "pull_request");
  assert.equal(nextActive("implementation", ["code_review", "e2e", "pull_request"]), "monitor");
});

test("requirement e plan pulados na largada → primeira ativa é implementation", () => {
  assert.equal(firstActive(["requirement", "plan"]), "implementation");
});

test("item totalmente simplificado: só implementation, depois monitor", () => {
  const all = [...SKIPPABLE_STAGES];
  assert.equal(firstActive(all), "implementation");
  assert.equal(nextActive("implementation", all), "monitor");
});

test("firstActiveStageIndex retorna -1 quando não há etapa ativa após a posição", () => {
  assert.equal(nextActive("monitor", []), null);
  assert.equal(nextActive("pull_request", []), "monitor");
});

test("sanitizeSkippedStages remove não-puláveis, deduplica e ordena por STAGE_ORDER", () => {
  assert.deepEqual(
    sanitizeSkippedStages(["e2e", "plan", "implementation", "intake", "monitor", "plan", "foo", 123, null]),
    ["plan", "e2e"],
  );
  assert.deepEqual(sanitizeSkippedStages("nope"), []);
  assert.deepEqual(sanitizeSkippedStages(null), []);
  assert.deepEqual(sanitizeSkippedStages([]), []);
});

test("validateSkippedStages aceita só etapas puláveis e deduplica", () => {
  assert.deepEqual(validateSkippedStages(["e2e", "plan", "plan"]), ["plan", "e2e"]);
  assert.deepEqual(validateSkippedStages([]), []);
});

test("validateSkippedStages rejeita implementation, intake, monitor e valores inválidos", () => {
  assert.throws(() => validateSkippedStages(["implementation"]), /não pode ser pulada/);
  assert.throws(() => validateSkippedStages(["intake"]), /não pode ser pulada/);
  assert.throws(() => validateSkippedStages(["monitor"]), /não pode ser pulada/);
  assert.throws(() => validateSkippedStages(["plan", 5]), /Etapa inválida/);
  assert.throws(() => validateSkippedStages("plan"), /deve ser um array/);
});
