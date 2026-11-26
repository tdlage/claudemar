import { test } from "node:test";
import assert from "node:assert/strict";
import { examDaysLeft, mergeProfile, parseStoredProfile, parseStudent, reviewOf } from "./profile.js";
import { parseDiagnosis } from "./schemas.js";
import type { Diagnosis, LearnerProfile } from "./types.js";

const earlier = new Date("2026-11-20T10:00:00Z");
const now = new Date("2026-11-26T10:00:00Z");

function weakness(id: string, priority: "alta" | "media" | "baixa", title = id) {
  return { id, title, skill: "ser_estar" as const, rule: `regra de ${id}`, interference: "", examples: [], priority, trend: "persistente" as const };
}

const previous: LearnerProfile = {
  weaknesses: [
    { ...weakness("ser-estar-estado", "alta"), since: earlier.toISOString() },
    { ...weakness("subjuntivo-ojala", "media"), since: earlier.toISOString() },
    { ...weakness("acentos-preterito", "baixa"), since: earlier.toISOString() },
  ],
  strengths: ["presente regular"],
  resolved: [{ id: "muy-mucho", title: "muy e mucho", resolvedAt: earlier.toISOString() }],
  pace: "manter",
  guidance: "antiga",
  updatedAt: earlier.toISOString(),
  lessonsAnalyzed: 4,
};

function diagnosis(overrides: Partial<Diagnosis>): Diagnosis {
  return {
    comment: "Bom trabalho.",
    weaknesses: [],
    strengths: ["conectores de contraste"],
    resolved: [],
    pace: "consolidar",
    guidance: "reforçar ser e estar",
    reinforcement: { recommended: true, reason: "ser e estar ainda escapa" },
    ...overrides,
  };
}

test("o diagnóstico novo mantém a data em que cada ponto fraco apareceu e ordena por prioridade", () => {
  const merged = mergeProfile(previous, diagnosis({
    weaknesses: [weakness("por-para", "alta"), weakness("subjuntivo-ojala", "alta")],
    resolved: ["acentos-preterito"],
  }), now);
  assert.deepEqual(merged.weaknesses.map((item) => item.id), ["por-para", "subjuntivo-ojala", "ser-estar-estado"]);
  assert.equal(merged.weaknesses.find((item) => item.id === "subjuntivo-ojala")!.since, earlier.toISOString());
  assert.equal(merged.weaknesses.find((item) => item.id === "por-para")!.since, now.toISOString());
  assert.equal(merged.weaknesses.find((item) => item.id === "subjuntivo-ojala")!.priority, "alta");
  assert.deepEqual(merged.resolved.map((item) => item.id), ["acentos-preterito", "muy-mucho"]);
  assert.equal(merged.resolved[0].resolvedAt, now.toISOString());
  assert.equal(merged.lessonsAnalyzed, 5);
  assert.equal(merged.pace, "consolidar");
});

test("um ponto fraco só sai da lista quando o professor o declara superado", () => {
  const merged = mergeProfile(previous, diagnosis({ weaknesses: [] }), now);
  assert.deepEqual(merged.weaknesses.map((item) => item.id), ["ser-estar-estado", "subjuntivo-ojala", "acentos-preterito"]);
  assert.deepEqual(merged.resolved.map((item) => item.id), ["muy-mucho"]);
});

test("um ponto superado que volta a aparecer sai da lista de superados", () => {
  const merged = mergeProfile(previous, diagnosis({ weaknesses: [weakness("muy-mucho", "media")] }), now);
  assert.ok(merged.weaknesses.some((item) => item.id === "muy-mucho"));
  assert.ok(!merged.resolved.some((item) => item.id === "muy-mucho"));
});

test("a lista de pontos fracos tem teto de 8", () => {
  const many = Array.from({ length: 12 }, (_, i) => weakness(`ponto-${i}`, i % 2 ? "baixa" : "alta"));
  const merged = mergeProfile(null, diagnosis({ weaknesses: many }), now);
  assert.equal(merged.weaknesses.length, 8);
  assert.ok(merged.weaknesses.slice(0, 6).every((item) => item.priority === "alta"));
  assert.equal(merged.lessonsAnalyzed, 1);
});

test("o perfil salvo sobrevive a ida e volta pelo banco", () => {
  const merged = mergeProfile(previous, diagnosis({ weaknesses: [weakness("por-para", "alta")] }), now);
  assert.deepEqual(parseStoredProfile(JSON.parse(JSON.stringify(merged))), merged);
  assert.equal(parseStoredProfile({ nada: true }), null);
  const review = reviewOf(diagnosis({}), now);
  assert.deepEqual(review, { comment: "Bom trabalho.", reinforcement: { recommended: true, reason: "ser e estar ainda escapa" }, pace: "consolidar", createdAt: now.toISOString() });
});

test("o diagnóstico do modelo é validado: ids viram kebab-case, sem regra o ponto é descartado", () => {
  const parsed = parseDiagnosis({
    comment: "Você evoluiu.",
    weaknesses: [
      { id: "Ser/Estar com Estados!", title: "Ser e estar", skill: "ser_estar", rule: "estado usa estar", interference: "", examples: [{ wrong: "es cansado", right: "está cansado" }, { wrong: "", right: "x" }], priority: "urgente", trend: "novo" },
      { id: "x", title: "Sem regra", skill: "gramatica", rule: "", interference: "", examples: [], priority: "alta", trend: "novo" },
    ],
    strengths: ["a", "a", "b"],
    resolved: [],
    pace: "devagar",
    guidance: "g",
    reinforcement: { recommended: "sim", reason: "r" },
  });
  assert.equal(parsed.weaknesses.length, 1);
  assert.equal(parsed.weaknesses[0].id, "ser-estar-com-estados");
  assert.equal(parsed.weaknesses[0].priority, "media");
  assert.equal(parsed.weaknesses[0].examples.length, 1);
  assert.deepEqual(parsed.strengths, ["a", "b"]);
  assert.equal(parsed.pace, "manter");
  assert.equal(parsed.reinforcement.recommended, false);
  assert.throws(() => parseDiagnosis({ comment: "" }), /comentário/);
});

test("os dados do aluno são saneados e a data da prova vira contagem regressiva", () => {
  const student = parseStudent({ goal: "  DELE em maio ", examDate: "2027-05-20", interests: "tecnologia", notes: "x".repeat(2000), variant: "americana" });
  assert.equal(student.goal, "DELE em maio");
  assert.equal(student.notes.length, 1500);
  assert.equal(student.variant, "americana");
  assert.equal(examDaysLeft(student, now), 175);
  assert.equal(parseStudent({ examDate: "2027-02-31", variant: "marciana" }).examDate, null);
  assert.equal(parseStudent(null).variant, "peninsular");
  assert.equal(examDaysLeft({ ...student, examDate: "2026-01-01" }, now), null);
});
