import type { RowDataPacket } from "mysql2/promise";
import { execute, query, toMySQLDatetime } from "../database.js";
import { replay, type Move, type Puzzle } from "./engine.js";
import { isValidLevel, PALETTE_SIZE, puzzleForLevel } from "./levels.js";
import type { GameProgress } from "./progress.js";

interface ProgressRow extends RowDataPacket {
  level: number;
  max_level: number;
  max_level_at: Date | string;
  levels_completed: number;
  puzzle: unknown;
  moves: unknown;
  undos_used: number;
}

interface RankingRow extends RowDataPacket {
  owner_id: string;
  max_level: number;
  max_level_at: Date | string;
  levels_completed: number;
}

export interface RankingRecord {
  player: string;
  maxLevel: number;
  reachedAt: Date;
  levelsCompleted: number;
}

const locks = new Map<string, Promise<void>>();

export function withPlayerLock<T>(player: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(player) ?? Promise.resolve();
  const run = previous.then(task);
  const settled = run.then(() => undefined, () => undefined);
  locks.set(player, settled);
  void settled.then(() => {
    if (locks.get(player) === settled) locks.delete(player);
  });
  return run;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isColorList(value: unknown, capacity: number): value is number[] {
  return Array.isArray(value)
    && value.length <= capacity
    && value.every((color) => Number.isInteger(color) && color >= 0 && color < PALETTE_SIZE);
}

function isPuzzle(value: unknown): value is Puzzle {
  if (!value || typeof value !== "object") return false;
  const { capacity, tubes } = value as Partial<Puzzle>;
  return Number.isInteger(capacity) && capacity! >= 2
    && Array.isArray(tubes) && tubes.length > 0
    && tubes.every((tube) => isColorList(tube, capacity!));
}

function isMoveList(value: unknown): value is Move[] {
  return Array.isArray(value)
    && value.every((move) => Array.isArray(move) && move.length === 2 && move.every((index) => Number.isInteger(index) && index >= 0));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value.replace(" ", "T")}Z`);
}

export async function loadProgress(player: string): Promise<GameProgress | null> {
  const [row] = await query<ProgressRow[]>(
    "SELECT level, max_level, max_level_at, levels_completed, puzzle, moves, undos_used FROM game_progress WHERE owner_id = ?",
    [player],
  );
  if (!row) return null;
  const level = isValidLevel(row.level) ? row.level : 1;
  const storedPuzzle = parseJson(row.puzzle);
  const storedMoves = parseJson(row.moves);
  const puzzle = isPuzzle(storedPuzzle) ? storedPuzzle : await puzzleForLevel(level);
  const resumable = isPuzzle(storedPuzzle) && isMoveList(storedMoves) && replay(puzzle, storedMoves) !== null;
  return {
    level,
    maxLevel: Math.max(level, row.max_level),
    maxLevelAt: toDate(row.max_level_at),
    levelsCompleted: row.levels_completed,
    puzzle,
    moves: resumable ? storedMoves : [],
    undosUsed: resumable ? row.undos_used : 0,
  };
}

export async function saveProgress(player: string, progress: GameProgress): Promise<void> {
  await execute(
    `INSERT INTO game_progress (owner_id, level, max_level, max_level_at, levels_completed, puzzle, moves, undos_used, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE level = VALUES(level), max_level = VALUES(max_level), max_level_at = VALUES(max_level_at),
       levels_completed = VALUES(levels_completed), puzzle = VALUES(puzzle), moves = VALUES(moves),
       undos_used = VALUES(undos_used), updated_at = VALUES(updated_at)`,
    [
      player,
      progress.level,
      progress.maxLevel,
      toMySQLDatetime(progress.maxLevelAt.toISOString()),
      progress.levelsCompleted,
      JSON.stringify(progress.puzzle),
      JSON.stringify(progress.moves),
      progress.undosUsed,
      toMySQLDatetime(new Date().toISOString()),
    ],
  );
}

export async function loadRanking(): Promise<RankingRecord[]> {
  const rows = await query<RankingRow[]>(
    "SELECT owner_id, max_level, max_level_at, levels_completed FROM game_progress ORDER BY max_level DESC, max_level_at ASC, owner_id ASC",
  );
  return rows.map((row) => ({
    player: row.owner_id,
    maxLevel: row.max_level,
    reachedAt: toDate(row.max_level_at),
    levelsCompleted: row.levels_completed,
  }));
}

export async function purgeGameProgress(player: string): Promise<void> {
  await execute("DELETE FROM game_progress WHERE owner_id = ?", [player]);
}
