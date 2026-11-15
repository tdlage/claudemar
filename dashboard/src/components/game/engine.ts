import type { Move, Tube } from "./types";

export interface PourRecord {
  from: number;
  to: number;
  amount: number;
}

export function topRun(tube: readonly number[]): number {
  const color = tube[tube.length - 1];
  let run = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === color; i--) run++;
  return run;
}

export function isComplete(tube: readonly number[], capacity: number): boolean {
  return tube.length === capacity && topRun(tube) === capacity;
}

export function isSolved(tubes: readonly (readonly number[])[], capacity: number): boolean {
  return tubes.every((tube) => tube.length === 0 || isComplete(tube, capacity));
}

export function pourAmount(tubes: readonly (readonly number[])[], from: number, to: number, capacity: number): number {
  const source = tubes[from];
  const target = tubes[to];
  if (from === to || !source || !target || source.length === 0 || target.length >= capacity) return 0;
  if (isComplete(source, capacity)) return 0;
  if (target.length > 0 && target[target.length - 1] !== source[source.length - 1]) return 0;
  return Math.min(topRun(source), capacity - target.length);
}

export function transfer(tubes: readonly (readonly number[])[], from: number, to: number, amount: number): Tube[] {
  const next = tubes.map((tube) => tube.slice());
  next[to].push(...next[from].splice(next[from].length - amount, amount));
  return next;
}

export function replay(start: readonly (readonly number[])[], moves: readonly Move[], capacity: number): { tubes: Tube[]; history: PourRecord[] } {
  let tubes = start.map((tube) => tube.slice());
  const history: PourRecord[] = [];
  for (const [from, to] of moves) {
    const amount = pourAmount(tubes, from, to, capacity);
    if (amount === 0) break;
    tubes = transfer(tubes, from, to, amount);
    history.push({ from, to, amount });
  }
  return { tubes, history };
}
