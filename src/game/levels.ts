import { searchCooperatively, type Puzzle, type Tube } from "./engine.js";

export const PALETTE_SIZE = 12;
const DISTINCT_COLORS = 6;

export interface LevelSpec {
  colors: number;
  capacity: number;
  empty: number;
}

const CAPACITY_BY_LEVEL: ReadonlyArray<{ from: number; capacity: number }> = [
  { from: 50, capacity: 7 },
  { from: 30, capacity: 6 },
  { from: 15, capacity: 5 },
  { from: 6, capacity: 4 },
  { from: 2, capacity: 3 },
  { from: 1, capacity: 2 },
];

const GENERATION_BUDGET = 60_000;
const GENERATION_SLICE = 250;
const MAX_ATTEMPTS = 400;
const CACHE_LIMIT = 256;

const cache = new Map<number, Puzzle>();
const inFlight = new Map<number, Promise<Puzzle>>();

export function isValidLevel(level: unknown): level is number {
  return typeof level === "number" && Number.isSafeInteger(level) && level >= 1;
}

export function levelSpec(level: number): LevelSpec {
  return {
    colors: Math.min(PALETTE_SIZE, 2 + Math.floor((level + 1) / 4)),
    capacity: CAPACITY_BY_LEVEL.find((step) => level >= step.from)?.capacity ?? 2,
    empty: level <= 2 ? 1 : 2,
  };
}

function seeded(text: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 0x01000193);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function longestRun(tube: Tube): number {
  let longest = 0;
  let current = 0;
  for (let i = 0; i < tube.length; i++) {
    current = i > 0 && tube[i] === tube[i - 1] ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function isWellMixed(tubes: Tube[], capacity: number): boolean {
  const limit = capacity <= 3 ? capacity - 1 : capacity - 2;
  return tubes.every((tube) => longestRun(tube) <= limit);
}

async function buildPuzzle(level: number): Promise<Puzzle> {
  const spec = levelSpec(level);
  const random = seeded(`decanta:${level}`);
  const pool = Array.from({ length: Math.max(spec.colors, DISTINCT_COLORS) }, (_, i) => i);
  const colors = shuffle(pool, random).slice(0, spec.colors);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const units = shuffle(colors.flatMap((color) => Array<number>(spec.capacity).fill(color)), random);
    const tubes: Tube[] = colors.map((_, i) => units.slice(i * spec.capacity, (i + 1) * spec.capacity));
    if (!isWellMixed(tubes, spec.capacity)) continue;
    for (let i = 0; i < spec.empty; i++) tubes.push([]);
    const outcome = await searchCooperatively(tubes, spec.capacity, GENERATION_BUDGET, GENERATION_SLICE);
    if (outcome.kind === "solved") return { capacity: spec.capacity, tubes };
  }
  throw new Error(`Não foi possível gerar a fase ${level}`);
}

function copyOf(puzzle: Puzzle): Puzzle {
  return { capacity: puzzle.capacity, tubes: puzzle.tubes.map((tube) => tube.slice()) };
}

function remember(level: number, puzzle: Puzzle): void {
  cache.delete(level);
  cache.set(level, puzzle);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export async function puzzleForLevel(level: number): Promise<Puzzle> {
  const cached = cache.get(level);
  if (cached) {
    remember(level, cached);
    return copyOf(cached);
  }
  let pending = inFlight.get(level);
  if (!pending) {
    pending = buildPuzzle(level).finally(() => inFlight.delete(level));
    inFlight.set(level, pending);
  }
  const puzzle = await pending;
  remember(level, puzzle);
  return copyOf(puzzle);
}

export function prepareLevel(level: number): void {
  if (cache.has(level) || inFlight.has(level)) return;
  puzzleForLevel(level).catch((err) => {
    console.error(`[game] falha ao preparar a fase ${level}:`, err instanceof Error ? err.message : String(err));
  });
}
