import { test } from "node:test";
import assert from "node:assert/strict";
import { errorsOf } from "./errors.js";
import type { ChoiceExercise, FillExercise, WriteExercise } from "./types.js";

const base = { focus: "", instruction: "x", explanation: "Ojalá pede subjuntivo.", lemmas: [] };
const fill: FillExercise = { ...base, type: "fill", skill: "conjugacion", focus: "presente de subjuntivo", prompt: "Ojalá ___ sol.", hint: "hacer", answers: ["haga"] };
const choice: ChoiceExercise = { ...base, type: "choice", skill: "falsos_amigos", prompt: "Está ___.", options: ["embarazada", "avergonzada"], answer: 1 };
const write: WriteExercise = { ...base, type: "write", skill: "conectores", task: "Escreva", requirements: [], minWords: 10, maxWords: 50, reference: "Modelo" };

test("acerto não gera erro; resposta sem correção ainda não conta", () => {
  assert.deepEqual(errorsOf(fill, { answer: "haga", status: "graded", verdict: "correct", score: 1 }), []);
  assert.deepEqual(errorsOf(fill, { answer: "hace", status: "grading" }), []);
});

test("lacuna errada vira erro da habilidade; só o acento errado vira erro de acentuação", () => {
  assert.deepEqual(errorsOf(fill, { answer: "hace", status: "graded", verdict: "incorrect", score: 0 }), [
    { category: "conjugacion", focus: "presente de subjuntivo", wrong: "hace", correct: "haga", explanation: "Ojalá pede subjuntivo." },
  ]);
  assert.equal(errorsOf(fill, { answer: "hagá", status: "graded", verdict: "partial", score: 0.5 })[0].category, "acentuacion");
});

test("na escolha, o erro guarda o texto da opção marcada e usa a habilidade quando não há foco", () => {
  const [error] = errorsOf(choice, { answer: 0, status: "graded", verdict: "incorrect", score: 0 });
  assert.deepEqual([error.category, error.focus, error.wrong, error.correct], ["falso_amigo", "falsos_amigos", "embarazada", "avergonzada"]);
});

test("na escrita, cada nota da correção vira um erro com a categoria apontada", () => {
  const errors = errorsOf(write, {
    answer: "texto",
    status: "graded",
    verdict: "partial",
    score: 0.7,
    corrected: "texto corrigido",
    notes: [
      { fragment: "en la lunes", correction: "el lunes", category: "preposicion", explanation: "sem preposição" },
      { fragment: "viajáis", correction: "viajéis", category: "conjugacion", explanation: "subjuntivo" },
    ],
  });
  assert.deepEqual(errors.map((error) => [error.category, error.wrong, error.correct]), [
    ["preposicion", "en la lunes", "el lunes"],
    ["conjugacion", "viajáis", "viajéis"],
  ]);
});

test("escrita errada sem notas ainda conta como um erro da habilidade", () => {
  const [error] = errorsOf(write, { answer: "Hola", status: "graded", verdict: "incorrect", score: 0, feedback: "Não cumpriu a tarefa." });
  assert.deepEqual([error.category, error.wrong, error.correct, error.explanation], ["conector", "Hola", "Modelo", "Não cumpriu a tarefa."]);
});
