import { test } from "node:test";
import assert from "node:assert/strict";
import { isComplete, search } from "./engine.js";
import { levelSpec, PALETTE_SIZE, puzzleForLevel } from "./levels.js";

test("a dificuldade nunca diminui: cores e divisões só crescem com a fase", () => {
  let previous = levelSpec(1);
  assert.deepEqual(previous, { colors: 2, capacity: 2, empty: 1 });
  for (let level = 2; level <= 200; level++) {
    const spec = levelSpec(level);
    assert.ok(spec.colors >= previous.colors && spec.capacity >= previous.capacity, `fase ${level}`);
    assert.ok(spec.colors <= PALETTE_SIZE);
    previous = spec;
  }
  assert.ok(previous.colors > levelSpec(1).colors && previous.capacity > levelSpec(1).capacity);
});

test("começa com um só frasco vazio e ganha o segundo apenas quando o tabuleiro cresce", () => {
  for (let level = 1; level <= 24; level++) assert.equal(levelSpec(level).empty, 1, `fase ${level}`);
  for (let level = 25; level <= 200; level++) assert.equal(levelSpec(level).empty, 2, `fase ${level}`);
});

test("cada fase é sempre o mesmo tabuleiro", async () => {
  assert.deepEqual(await puzzleForLevel(17), await puzzleForLevel(17));
  assert.notDeepEqual((await puzzleForLevel(17)).tubes, (await puzzleForLevel(18)).tubes);
});

test("as fases têm a composição da especificação, começam embaralhadas e têm solução", async () => {
  for (let level = 1; level <= 60; level++) {
    const spec = levelSpec(level);
    const puzzle = await puzzleForLevel(level);
    assert.equal(puzzle.capacity, spec.capacity);
    assert.equal(puzzle.tubes.length, spec.colors + spec.empty);
    assert.equal(puzzle.tubes.filter((tube) => tube.length === 0).length, spec.empty);
    const counts = new Map<number, number>();
    for (const color of puzzle.tubes.flat()) counts.set(color, (counts.get(color) ?? 0) + 1);
    assert.equal(counts.size, spec.colors, `fase ${level}`);
    assert.ok([...counts.values()].every((count) => count === spec.capacity), `fase ${level}`);
    assert.ok(puzzle.tubes.every((tube) => !isComplete(tube, spec.capacity)), `fase ${level}`);
    assert.equal(search(puzzle.tubes, puzzle.capacity, 200_000).kind, "solved", `fase ${level}`);
  }
});

test("com poucas cores, a fase usa só as cores mais fáceis de distinguir", async () => {
  for (let level = 1; level <= 22; level++) {
    const colors = new Set((await puzzleForLevel(level)).tubes.flat());
    if (levelSpec(level).colors <= 6) assert.ok([...colors].every((color) => color < 6), `fase ${level}`);
  }
});

test("o tabuleiro devolvido é uma cópia independente do cache", async () => {
  const first = await puzzleForLevel(5);
  first.tubes[0].push(99);
  assert.ok(!(await puzzleForLevel(5)).tubes[0].includes(99));
});
