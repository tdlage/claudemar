import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, search, type Move } from "./engine.js";
import { puzzleForLevel } from "./levels.js";
import { chooseLevel, MOVE_LIMIT, playMove, restartLevel, startProgress, undoMove, UNDO_LIMIT, viewOf, type GameProgress, type Transition } from "./progress.js";

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
  assert.deepEqual({ level: progress.level, maxLevel: progress.maxLevel, moves: progress.moves, undosUsed: progress.undosUsed }, { level: 1, maxLevel: 1, moves: [], undosUsed: 0 });
  assert.deepEqual(progress.puzzle, await puzzleForLevel(1));
  assert.equal(viewOf(progress).undosLeft, UNDO_LIMIT);
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

test("desfazer tem limite por tentativa e reiniciar devolve os desfazer", async () => {
  let progress = await startProgress(NOW);
  const [first] = await solutionFor(progress);
  assert.deepEqual(undoMove(progress, 0), { ok: false, reason: "nothing-to-undo" });
  for (let i = 0; i < UNDO_LIMIT; i++) {
    progress = accepted(await playMove(progress, first, 0, NOW));
    assert.deepEqual(undoMove(progress, 0), { ok: false, reason: "out-of-sync" });
    progress = accepted(undoMove(progress, 1));
  }
  progress = accepted(await playMove(progress, first, 0, NOW));
  assert.deepEqual(undoMove(progress, 1), { ok: false, reason: "no-undos-left" });
  assert.equal(viewOf(progress).undosLeft, 0);
  progress = accepted(restartLevel(progress));
  assert.deepEqual(progress.moves, []);
  assert.equal(viewOf(progress).undosLeft, UNDO_LIMIT);
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

test("o estado mostra quando o jogador travou", async () => {
  const progress: GameProgress = { ...(await startProgress(NOW)), puzzle: { capacity: 2, tubes: [[0, 1], [1, 0], []] }, moves: [] };
  assert.equal(viewOf(progress).status, "playing");
  assert.equal(viewOf({ ...progress, puzzle: { capacity: 2, tubes: [[0, 1], [1, 0]] } }).status, "stuck");
});
