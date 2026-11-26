import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords, gradeChoice, gradeFill, normalizeAnswer } from "./grading.js";

test("a normalização ignora caixa, espaços e pontuação nas bordas, mas preserva acentos e ñ", () => {
  assert.equal(normalizeAnswer("  ¿Tuviste   Razón?  "), "tuviste razón");
  assert.equal(normalizeAnswer("año"), "año");
  assert.notEqual(normalizeAnswer("año"), normalizeAnswer("ano"));
});

test("lacuna: aceita qualquer variante listada", () => {
  assert.deepEqual(gradeFill(["hubiera", "hubiese"], "Hubiese"), { verdict: "correct", score: 1 });
});

test("lacuna: só o acento errado vale meio ponto; ñ trocado por n é erro", () => {
  assert.deepEqual(gradeFill(["tuve"], "tuvé"), { verdict: "partial", score: 0.5 });
  assert.deepEqual(gradeFill(["está"], "esta"), { verdict: "partial", score: 0.5 });
  assert.deepEqual(gradeFill(["año"], "ano"), { verdict: "incorrect", score: 0 });
  assert.deepEqual(gradeFill(["estuve"], "estive"), { verdict: "incorrect", score: 0 });
});

test("escolha compara o índice", () => {
  assert.equal(gradeChoice(2, 2).verdict, "correct");
  assert.equal(gradeChoice(2, 1).verdict, "incorrect");
});

test("conta só palavras com letras", () => {
  assert.equal(countWords("Sin embargo, — llegué tarde 3 veces."), 5);
  assert.equal(countWords("   "), 0);
});
