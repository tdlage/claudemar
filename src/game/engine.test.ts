import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPour, isDeadEnd, isSolved, pourAmount, replay, search } from "./engine.js";

test("despeja toda a sequência do topo quando cabe no destino", () => {
  const tubes = [[0, 1, 1], [1], []];
  assert.equal(pourAmount(tubes, 0, 1, 4), 2);
  assert.deepEqual(applyPour(tubes, 0, 1, 4), [[0], [1, 1, 1], []]);
});

test("despeja só o que cabe e mantém o resto da sequência na origem", () => {
  assert.deepEqual(applyPour([[0, 1, 1, 1], [0, 0, 1], []], 0, 1, 4), [[0, 1, 1], [0, 0, 1, 1], []]);
});

test("recusa cor diferente, destino cheio, origem vazia e o próprio frasco", () => {
  const tubes = [[0, 1], [0, 0], [1, 1, 0, 0], []];
  assert.equal(pourAmount(tubes, 0, 1, 4), 0);
  assert.equal(pourAmount(tubes, 1, 2, 4), 0);
  assert.equal(pourAmount(tubes, 3, 0, 4), 0);
  assert.equal(pourAmount(tubes, 0, 0, 4), 0);
});

test("frasco completo fica lacrado", () => {
  assert.equal(pourAmount([[2, 2, 2], []], 0, 1, 3), 0);
});

test("replay rejeita qualquer jogada inválida da sequência", () => {
  const puzzle = { capacity: 2, tubes: [[0, 1], [1, 0], []] };
  assert.deepEqual(replay(puzzle, [[0, 2], [1, 0]]), [[0, 0], [1], [1]]);
  assert.equal(replay(puzzle, [[0, 1]]), null);
});

test("o solver devolve uma solução que o replay confirma", () => {
  const puzzle = { capacity: 4, tubes: [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2], [], []] };
  const outcome = search(puzzle.tubes, puzzle.capacity, 50_000);
  assert.equal(outcome.kind, "solved");
  const final = replay(puzzle, outcome.kind === "solved" ? outcome.moves : []);
  assert.ok(final && isSolved(final, puzzle.capacity));
});

test("sem nenhuma jogada possível é beco sem saída", () => {
  assert.equal(isDeadEnd([[0, 1], [1, 0]], 2, 1_000), true);
});

test("ficar passando a mesma cor entre dois frascos é beco sem saída", () => {
  const tubes = [[0, 2, 2], [1, 2], [0, 1, 0], [1]];
  assert.equal(pourAmount(tubes, 0, 1, 3), 1);
  assert.equal(isDeadEnd(tubes, 3, 1_000), true);
});

test("tabuleiro com saída não é beco", () => {
  assert.equal(isDeadEnd([[0, 1], [1, 0], []], 2, 1_000), false);
});

test("quando o orçamento acaba antes da conclusão, não declara beco", () => {
  assert.equal(isDeadEnd([[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1], [], []], 4, 1), false);
});
