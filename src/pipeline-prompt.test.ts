import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanReposInstruction } from "./pipeline-prompt.js";

test("instrui a reportar somente os repositórios afetados (claudemar#7 critério 4)", () => {
  const out = buildPlanReposInstruction([]);
  assert.match(out, /## Repositórios afetados/);
  assert.match(out, /report_plan/);
  assert.match(out, /SOMENTE os repositórios que serão de fato alterados/);
});

test("sem repositórios-alvo, pede que o agente identifique os repositórios (claudemar#7 critério 4)", () => {
  const out = buildPlanReposInstruction([]);
  assert.match(out, /ainda não tem repositórios-alvo definidos/);
});

test("com repositórios-alvo, apresenta a lista como restrição/auxílio (claudemar#7 critério 5)", () => {
  const out = buildPlanReposInstruction(["claudemar", "infra"]);
  assert.match(out, /repositórios-alvo atuais do card são: claudemar, infra/);
  assert.match(out, /Priorize-os/);
  assert.match(out, /justifique explicitamente/);
});
