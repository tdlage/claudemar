import { test } from "node:test";
import assert from "node:assert/strict";
import { currentStreak, isTimeZone, nextStreak, review, studyDay, TOP_BOX } from "./srs.js";

const DAY = 86_400_000;
const now = new Date("2026-11-26T15:00:00Z");

test("acerto em palavra devida sobe uma caixa e afasta a próxima revisão", () => {
  const first = review({ box: 0, dueAt: now }, "correct", now);
  assert.deepEqual(first, { box: 1, dueAt: new Date(now.getTime() + DAY) });
  const later = new Date(now.getTime() + DAY);
  assert.deepEqual(review(first, "correct", later), { box: 2, dueAt: new Date(later.getTime() + 3 * DAY) });
});

test("acertar de novo antes do prazo não promove a palavra", () => {
  const state = { box: 2, dueAt: new Date(now.getTime() + 2 * DAY) };
  assert.deepEqual(review(state, "correct", now), state);
});

test("erro volta para a caixa zero e deixa a palavra devida", () => {
  assert.deepEqual(review({ box: 5, dueAt: new Date(now.getTime() + 20 * DAY) }, "incorrect", now), { box: 0, dueAt: now });
});

test("meio acerto mantém a caixa e traz a revisão para no máximo um dia", () => {
  const result = review({ box: 3, dueAt: new Date(now.getTime() + 6 * DAY) }, "partial", now);
  assert.deepEqual(result, { box: 3, dueAt: new Date(now.getTime() + DAY) });
});

test("a caixa tem teto", () => {
  assert.equal(review({ box: TOP_BOX, dueAt: now }, "correct", now).box, TOP_BOX);
});

test("o dia de estudo respeita o fuso do aluno", () => {
  const lateNight = new Date("2026-11-27T01:30:00Z");
  assert.equal(studyDay(lateNight, "America/Sao_Paulo"), "2026-11-26");
  assert.equal(studyDay(lateNight, "UTC"), "2026-11-27");
  assert.ok(isTimeZone("America/Sao_Paulo"));
  assert.ok(!isTimeZone("Marte/Olimpo"));
  assert.ok(!isTimeZone(42));
});

test("a sequência cresce em dias seguidos, se mantém no mesmo dia e reinicia depois de um buraco", () => {
  assert.equal(nextStreak(null, 0, "2026-11-26"), 1);
  assert.equal(nextStreak("2026-11-25", 4, "2026-11-26"), 5);
  assert.equal(nextStreak("2026-11-26", 5, "2026-11-26"), 5);
  assert.equal(nextStreak("2026-11-23", 9, "2026-11-26"), 1);
  assert.equal(nextStreak("2026-02-28", 2, "2026-03-01"), 3);
  assert.equal(currentStreak("2026-11-25", 5, "2026-11-26"), 5);
  assert.equal(currentStreak("2026-11-24", 5, "2026-11-26"), 0);
});
