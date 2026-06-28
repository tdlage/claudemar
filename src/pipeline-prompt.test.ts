import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanReposInstruction } from "./pipeline-prompt.js";

test("instrui a reportar somente os repositórios afetados (claudemar#7 critério 4)", () => {
  const out = buildPlanReposInstruction([]);
  assert.match(out, /## Repositórios afetados/);
  assert.match(out, /report_plan/);
  assert.match(out, /SOMENTE os repositórios que serão de fato alterados/);
});

test("sem pré-seleção, pede que o agente identifique os repositórios (claudemar#7 critério 4)", () => {
  const out = buildPlanReposInstruction([]);
  assert.match(out, /não pré-selecionou repositórios/);
});

test("com pré-seleção, apresenta a lista como restrição/auxílio (claudemar#7 critério 5)", () => {
  const out = buildPlanReposInstruction(["claudemar", "infra"]);
  assert.match(out, /pré-selecionou estes repositórios-alvo: claudemar, infra/);
  assert.match(out, /Restrinja os repositórios reportados a esse conjunto/);
  assert.match(out, /justifique explicitamente/);
});
