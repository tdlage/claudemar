import { test } from "node:test";
import assert from "node:assert/strict";
import { lemmaKey, parseAppeal, parseAssessment, parseLesson, parsePlan } from "./schemas.js";

function unit(index: number) {
  return {
    level: index < 8 ? "A2+" : "B1",
    titleEs: `Unidad ${index}`,
    titlePt: `Unidade ${index}`,
    theme: "trabajo",
    grammar: ["pretérito indefinido"],
    connectors: ["sin embargo", "sin embargo"],
    contrasts: ["ser y estar"],
    dele: "Expresión escrita, tarea 1",
  };
}

const exercises = [
  { type: "choice", skill: "ser_estar", focus: "estar casado", instruction: "Escolha", explanation: "x", lemmas: ["Casado"], prompt: "Mi hermana ___ casada.", options: ["es", "está"], answer: 1 },
  { type: "fill", skill: "conjugacion", focus: "pretérito indefinido", instruction: "Complete", explanation: "x", lemmas: [], prompt: "Ayer ____ que trabajar.", hint: "tener · yo", answers: ["tuve"] },
  { type: "translate", skill: "conectores", focus: "sin embargo", instruction: "Traduza", explanation: "x", lemmas: [], source: "Choveu; no entanto, saímos.", reference: "Llovió; sin embargo, salimos." },
  { type: "write", skill: "conectores", focus: "conectores", instruction: "Escreva", explanation: "x", lemmas: [], task: "Conte", requirements: ["además"], minWords: 20, maxWords: 40, reference: "Ayer..." },
  { type: "choice", skill: "falsos_amigos", focus: "exquisito", instruction: "Escolha", explanation: "x", lemmas: [], prompt: "La comida está ___.", options: ["exquisita", "rara"], answer: 0 },
  { type: "fill", skill: "vocabulario", focus: "apellido", instruction: "Complete", explanation: "x", lemmas: ["apellido"], prompt: "Mi ___ es Silva.", hint: "", answers: ["apellido"] },
];

const lesson = {
  title: "El trabajo",
  goal: "Falar do trabalho",
  explanation: { title: "Ser y estar", body: "Texto", examples: [{ es: "Está casado.", pt: "É casado." }] },
  vocabulary: [
    { lemma: "Apellido", display: "el apellido", partOfSpeech: "substantivo", translation: "sobrenome", exampleEs: "", examplePt: "", note: "Falso amigo", contrast: "falso_amigo" },
    { lemma: "apellido", display: "el apellido", partOfSpeech: "substantivo", translation: "sobrenome", exampleEs: "", examplePt: "", note: "", contrast: "falso_amigo" },
    { lemma: "puente", display: "el puente", partOfSpeech: "substantivo", translation: "ponte", exampleEs: "", examplePt: "", note: "", contrast: "desconhecido" },
  ],
  reading: null,
  exercises,
};

test("o plano exige um mínimo de unidades válidas e remove repetições", () => {
  const plan = parsePlan({ units: Array.from({ length: 30 }, (_, i) => unit(i)) });
  assert.equal(plan.units.length, 30);
  assert.deepEqual(plan.units[0].connectors, ["sin embargo"]);
  assert.throws(() => parsePlan({ units: Array.from({ length: 5 }, (_, i) => unit(i)) }), /mínimo/);
  assert.throws(() => parsePlan(null), /mínimo/);
});

test("a aula normaliza lemas, deduplica o vocabulário e uniformiza a lacuna", () => {
  const parsed = parseLesson(lesson);
  assert.deepEqual(parsed.vocabulary.map((word) => word.lemma), ["apellido", "puente"]);
  assert.equal(parsed.vocabulary[1].contrast, "nenhum");
  const fill = parsed.exercises[1];
  assert.equal(fill.type === "fill" && fill.prompt, "Ayer ___ que trabajar.");
  assert.deepEqual(parsed.exercises[0].lemmas, ["casado"]);
});

test("exercícios inconsistentes são descartados e poucos exercícios invalidam a aula", () => {
  const broken = [
    { ...exercises[0], answer: 5 },
    { ...exercises[0], options: ["es", "es"] },
    { ...exercises[1], prompt: "Sem lacuna" },
    { ...exercises[1], prompt: "___ y ___" },
    { ...exercises[3], minWords: 50, maxWords: 10 },
    { ...exercises[2], type: "desconhecido" },
  ];
  const parsed = parseLesson({ ...lesson, exercises: [...exercises, ...broken] });
  assert.equal(parsed.exercises.length, exercises.length);
  assert.throws(() => parseLesson({ ...lesson, exercises: broken }), /mínimo/);
  assert.throws(() => parseLesson({ ...lesson, explanation: null }), /explicação/);
});

test("a correção limita a nota e exige comentário", () => {
  const assessment = parseAssessment({ verdict: "partial", score: 3, feedback: "Bom", corrected: "", improved: "", notes: [{ fragment: "a", correction: "b", category: "outra", explanation: "" }] });
  assert.equal(assessment.score, 1);
  assert.equal(assessment.notes[0].category, "gramatica");
  assert.equal(parseAssessment({ verdict: "incorrect", score: "x", feedback: "Não" }).score, 0);
  assert.throws(() => parseAssessment({ verdict: "correct", score: 1, feedback: "" }), /comentário/);
  assert.throws(() => parseAppeal({ accepted: "sim", explanation: "x" }), /incompleta/);
});

test("a chave do lema diferencia ñ de n", () => {
  assert.equal(lemmaKey("  Año "), "año");
  assert.notEqual(lemmaKey("año"), lemmaKey("ano"));
});
