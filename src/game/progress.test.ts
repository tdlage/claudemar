import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, search, type Move } from "./engine.js";
import { puzzleForLevel } from "./levels.js";
import { assessBoard, chooseLevel, MOVE_LIMIT, playMove, restartLevel, startProgress, undoMove, viewOf, type GameProgress, type Transition } from "./progress.js";

const NOW = new Date("2026-11-15T12:00:00Z");

function accepted(result: Transition): GameProgress {
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.progress;
}

async function solutionFor(progress: GameProgress): Promise<Move[]> {
  const outcome = search(progress.puzzle.tubes, progress.puzzle.capacity, 200_000);
  assert.equal(outcome.kind, "solved");
  return outcome.kind === "solved" ? outcome.moves : [];
}

async function solveLevel(progress: GameProgress, now = NOW): Promise<Transition> {
  const moves = await solutionFor(progress);
  let current = progress;
  for (const [i, move] of moves.entries()) {
    const result = await playMove(current, move, i, now);
    if (i === moves.length - 1) return result;
    current = accepted(result);
  }
  throw new Error("fase sem jogadas");
}

test("um jogador novo começa na fase 1 com tudo zerado", async () => {
  const progress = await startProgress(NOW);
  assert.deepEqual({ level: progress.level, maxLevel: progress.maxLevel, moves: progress.moves }, { level: 1, maxLevel: 1, moves: [] });
  assert.deepEqual(progress.puzzle, await puzzleForLevel(1));
});

test("resolver a fase avança e registra o recorde só quando passa do máximo", async () => {
  const solved = await solveLevel(await startProgress(NOW), new Date("2026-11-15T12:05:00Z"));
  assert.ok(solved.ok);
  assert.deepEqual(solved.completed, { level: 1, moves: (await solutionFor(await startProgress(NOW))).length, record: true });
  assert.equal(solved.progress.level, 2);
  assert.equal(solved.progress.maxLevel, 2);
  assert.equal(solved.progress.levelsCompleted, 1);
  assert.equal(solved.progress.maxLevelAt.toISOString(), "2026-11-15T12:05:00.000Z");
  assert.deepEqual(solved.progress.moves, []);

  const replayed = accepted(await chooseLevel(solved.progress, 1));
  const again = await solveLevel(replayed, new Date("2026-11-16T09:00:00Z"));
  assert.ok(again.ok);
  assert.equal(again.completed?.record, false);
  assert.equal(again.progress.maxLevel, 2);
  assert.equal(again.progress.maxLevelAt.toISOString(), "2026-11-15T12:05:00.000Z");
  assert.equal(again.progress.levelsCompleted, 2);
});

test("jogada fora de sequência ou inválida não altera o progresso", async () => {
  const progress = await startProgress(NOW);
  assert.deepEqual(await playMove(progress, [0, 2], 3, NOW), { ok: false, reason: "out-of-sync" });
  assert.deepEqual(await playMove(progress, [2, 0], 0, NOW), { ok: false, reason: "invalid-move" });
  assert.deepEqual(await playMove(progress, [0, 9], 0, NOW), { ok: false, reason: "invalid-move" });
});

test("reiniciar volta a fase ao tabuleiro inicial", async () => {
  const start = await startProgress(NOW);
  const [first] = await solutionFor(start);
  const played = accepted(await playMove(start, first, 0, NOW));
  const restarted = accepted(restartLevel(played));
  assert.deepEqual(restarted.moves, []);
  assert.deepEqual(restarted.puzzle, start.puzzle);
});

test("desfazer volta uma jogada por vez até o início da fase", async () => {
  const start = await startProgress(NOW);
  const [first, second] = await solutionFor(start);
  const once = accepted(await playMove(start, first, 0, NOW));
  const twice = accepted(await playMove(once, second, 1, NOW));

  assert.deepEqual(undoMove(twice, 0), { ok: false, reason: "out-of-sync" });
  const undone = accepted(undoMove(twice, 1));
  assert.deepEqual(undone.moves, [first]);
  assert.deepEqual(replay(undone.puzzle, undone.moves), replay(once.puzzle, once.moves));

  const back = accepted(undoMove(undone, 0));
  assert.deepEqual(back.moves, []);
  assert.deepEqual(replay(back.puzzle, back.moves), start.puzzle.tubes);
  assert.deepEqual(undoMove(back, 0), { ok: false, reason: "out-of-sync" });
});

test("desfazer tira a tentativa do limite e de um beco sem saída", async () => {
  const start = await startProgress(NOW);
  const stuck: GameProgress = { ...start, puzzle: { capacity: 2, tubes: [[0, 1], [1, 0], [2], [3, 2]] }, moves: [[3, 2]] };
  assert.equal(viewOf(stuck).status, "stuck");
  assert.equal(viewOf(accepted(undoMove(stuck, 0))).status, "playing");

  const board: GameProgress = { ...start, puzzle: { capacity: 3, tubes: [[0, 2, 2], [1, 2], [0, 1, 0], [1]] } };
  const pingPong = Array.from({ length: MOVE_LIMIT }, (_, i): Move => (i % 2 === 0 ? [0, 1] : [1, 0]));
  const exhausted = { ...board, moves: pingPong };
  assert.equal(viewOf(accepted(undoMove(exhausted, MOVE_LIMIT - 1))).status, "playing");
});

test("a verificação diz se o tabuleiro atual ainda tem solução", async () => {
  const start = await startProgress(NOW);
  assert.equal(await assessBoard(start), "solvable");

  const midGame: GameProgress = { ...start, puzzle: { capacity: 2, tubes: [[0, 1], [1, 2], [2, 0], []] }, moves: [[0, 3]] };
  assert.equal(await assessBoard(midGame), "solvable");
  const deadEnd: GameProgress = { ...start, puzzle: { capacity: 3, tubes: [[0, 1, 2], [0, 1, 2], [0, 1, 2], []] }, moves: [[0, 3]] };
  assert.equal(viewOf(deadEnd).status, "playing");
  assert.equal(await assessBoard(deadEnd), "unsolvable");
});

test("só dá para escolher fases já alcançadas", async () => {
  const progress = { ...(await startProgress(NOW)), maxLevel: 10 };
  assert.deepEqual(await chooseLevel(progress, 11), { ok: false, reason: "locked-level" });
  assert.deepEqual(await chooseLevel(progress, 0), { ok: false, reason: "locked-level" });
  assert.deepEqual(await chooseLevel(progress, 2.5), { ok: false, reason: "locked-level" });
  const chosen = accepted(await chooseLevel(progress, 10));
  assert.equal(chosen.level, 10);
  assert.deepEqual(chosen.puzzle, await puzzleForLevel(10));
});

test("cada tentativa tem um limite de jogadas", async () => {
  const start = await startProgress(NOW);
  const board: GameProgress = { ...start, puzzle: { capacity: 3, tubes: [[0, 2, 2], [1, 2], [0, 1, 0], [1]] } };
  const pingPong = Array.from({ length: MOVE_LIMIT }, (_, i): Move => (i % 2 === 0 ? [0, 1] : [1, 0]));
  const full = { ...board, moves: pingPong };
  assert.ok(replay(full.puzzle, pingPong));
  assert.equal(viewOf(full).status, "exhausted");
  assert.deepEqual(await playMove(full, [0, 1], MOVE_LIMIT, NOW), { ok: false, reason: "move-limit" });
  assert.notEqual(viewOf(accepted(restartLevel(full))).status, "exhausted");
});

test("só declara que travou quando não resta nenhuma jogada", async () => {
  const progress: GameProgress = { ...(await startProgress(NOW)), puzzle: { capacity: 3, tubes: [[0, 2, 2], [1, 2], [0, 1, 0], [1]] }, moves: [] };
  assert.equal(viewOf(progress).status, "playing");
  assert.equal(viewOf({ ...progress, puzzle: { capacity: 2, tubes: [[0, 1], [1, 0]] } }).status, "stuck");
});
