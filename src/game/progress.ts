import { applyPour, hasMoves, isSolved, replay, searchCooperatively, type Move, type Puzzle, type Tube } from "./engine.js";
import { isValidLevel, prepareLevel, puzzleForLevel } from "./levels.js";

export const MOVE_LIMIT = 1_000;
const CHECK_BUDGET = 250_000;
const CHECK_SLICE = 500;

export interface GameProgress {
  level: number;
  maxLevel: number;
  maxLevelAt: Date;
  levelsCompleted: number;
  puzzle: Puzzle;
  moves: Move[];
}

export type GameStatus = "playing" | "stuck" | "exhausted";

export type Verdict = "solvable" | "unsolvable" | "unknown";

export interface GameView {
  level: number;
  maxLevel: number;
  levelsCompleted: number;
  capacity: number;
  tubes: Tube[];
  moves: Move[];
  moveLimit: number;
  status: GameStatus;
}

export interface CompletedLevel {
  level: number;
  moves: number;
  record: boolean;
}

export type Rejection = "out-of-sync" | "invalid-move" | "move-limit" | "locked-level";

export type Transition =
  | { ok: true; progress: GameProgress; completed?: CompletedLevel }
  | { ok: false; reason: Rejection };

export async function startProgress(now: Date): Promise<GameProgress> {
  prepareLevel(2);
  return { level: 1, maxLevel: 1, maxLevelAt: now, levelsCompleted: 0, puzzle: await puzzleForLevel(1), moves: [] };
}

export function boardOf(progress: GameProgress): Tube[] {
  const tubes = replay(progress.puzzle, progress.moves);
  if (!tubes) throw new Error("Jogadas salvas não correspondem ao tabuleiro da fase");
  return tubes;
}

function statusOf(progress: GameProgress): GameStatus {
  if (progress.moves.length >= MOVE_LIMIT) return "exhausted";
  return hasMoves(boardOf(progress), progress.puzzle.capacity) ? "playing" : "stuck";
}

export function viewOf(progress: GameProgress): GameView {
  const { capacity } = progress.puzzle;
  return {
    level: progress.level,
    maxLevel: progress.maxLevel,
    levelsCompleted: progress.levelsCompleted,
    capacity,
    tubes: progress.puzzle.tubes,
    moves: progress.moves,
    moveLimit: MOVE_LIMIT,
    status: statusOf(progress),
  };
}

async function enterLevel(progress: GameProgress, level: number): Promise<GameProgress> {
  const puzzle = await puzzleForLevel(level);
  prepareLevel(level + 1);
  return { ...progress, level, puzzle, moves: [] };
}

export async function playMove(progress: GameProgress, move: Move, index: number, now: Date): Promise<Transition> {
  if (index !== progress.moves.length) return { ok: false, reason: "out-of-sync" };
  if (progress.moves.length >= MOVE_LIMIT) return { ok: false, reason: "move-limit" };
  const tubes = applyPour(boardOf(progress), move[0], move[1], progress.puzzle.capacity);
  if (!tubes) return { ok: false, reason: "invalid-move" };
  if (!isSolved(tubes, progress.puzzle.capacity)) {
    return { ok: true, progress: { ...progress, moves: [...progress.moves, move] } };
  }
  const next = progress.level + 1;
  const record = next > progress.maxLevel;
  const advanced = await enterLevel({
    ...progress,
    maxLevel: record ? next : progress.maxLevel,
    maxLevelAt: record ? now : progress.maxLevelAt,
    levelsCompleted: progress.levelsCompleted + 1,
  }, next);
  return { ok: true, progress: advanced, completed: { level: progress.level, moves: progress.moves.length + 1, record } };
}

export function undoMove(progress: GameProgress, index: number): Transition {
  if (index !== progress.moves.length - 1) return { ok: false, reason: "out-of-sync" };
  return { ok: true, progress: { ...progress, moves: progress.moves.slice(0, -1) } };
}

export async function assessBoard(progress: GameProgress): Promise<Verdict> {
  const outcome = await searchCooperatively(boardOf(progress), progress.puzzle.capacity, CHECK_BUDGET, CHECK_SLICE);
  if (outcome.kind === "solved") return "solvable";
  return outcome.kind === "exhausted" ? "unsolvable" : "unknown";
}

export function restartLevel(progress: GameProgress): Transition {
  return { ok: true, progress: { ...progress, moves: [] } };
}

export async function chooseLevel(progress: GameProgress, level: unknown): Promise<Transition> {
  if (!isValidLevel(level) || level > progress.maxLevel) return { ok: false, reason: "locked-level" };
  return { ok: true, progress: await enterLevel(progress, level) };
}
