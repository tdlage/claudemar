export type Tube = number[];
export type Move = [from: number, to: number];

export interface Puzzle {
  capacity: number;
  tubes: Tube[];
}

export type SearchOutcome =
  | { kind: "solved"; moves: Move[] }
  | { kind: "exhausted" }
  | { kind: "budget" };

interface Pour {
  from: number;
  to: number;
  amount: number;
  score: number;
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

export function applyPour(tubes: readonly (readonly number[])[], from: number, to: number, capacity: number): Tube[] | null {
  const amount = pourAmount(tubes, from, to, capacity);
  if (amount === 0) return null;
  const next = tubes.map((tube) => tube.slice());
  next[to].push(...next[from].splice(next[from].length - amount, amount));
  return next;
}

export function replay(puzzle: Puzzle, moves: readonly Move[]): Tube[] | null {
  let tubes: Tube[] = puzzle.tubes.map((tube) => tube.slice());
  for (const [from, to] of moves) {
    const next = applyPour(tubes, from, to, puzzle.capacity);
    if (!next) return null;
    tubes = next;
  }
  return tubes;
}

function tubeCode(tube: readonly number[]): string {
  let code = "";
  for (const color of tube) code += String.fromCharCode(65 + color);
  return code;
}

function isUniform(tube: readonly number[], length: number): boolean {
  for (let i = 1; i < length; i++) if (tube[i] !== tube[0]) return false;
  return true;
}

function scorePour(source: Tube, target: Tube, amount: number, capacity: number): number {
  const run = topRun(source);
  const targetUniform = target.length > 0 && topRun(target) === target.length;
  let score = target.length === 0 ? -2 : targetUniform ? 4 : 1;
  if (target.length + amount === capacity && (targetUniform || target.length === 0)) score += 10;
  if (amount < run) return score - 4;
  const remaining = source.length - run;
  if (remaining === 0) score += 3;
  else if (isUniform(source, remaining)) score += 2;
  return score;
}

function availablePours(tubes: Tube[], capacity: number): Pour[] {
  const pours: Pour[] = [];
  for (let from = 0; from < tubes.length; from++) {
    const source = tubes[from];
    if (source.length === 0 || isComplete(source, capacity)) continue;
    const color = source[source.length - 1];
    const run = topRun(source);
    let emptyTried = false;
    for (let to = 0; to < tubes.length; to++) {
      const target = tubes[to];
      if (to === from || target.length >= capacity) continue;
      if (target.length === 0) {
        if (run === source.length || emptyTried) continue;
        emptyTried = true;
      } else if (target[target.length - 1] !== color) continue;
      const amount = Math.min(run, capacity - target.length);
      pours.push({ from, to, amount, score: scorePour(source, target, amount, capacity) });
    }
  }
  return pours.sort((a, b) => b.score - a.score);
}

class SearchState {
  readonly tubes: Tube[];
  private readonly codes: string[];

  constructor(start: readonly (readonly number[])[]) {
    this.tubes = start.map((tube) => tube.slice());
    this.codes = this.tubes.map(tubeCode);
  }

  key(): string {
    return this.codes.slice().sort().join("|");
  }

  apply(pour: Pour): void {
    this.transfer(pour.from, pour.to, pour.amount);
  }

  revert(pour: Pour): void {
    this.transfer(pour.to, pour.from, pour.amount);
  }

  private transfer(from: number, to: number, amount: number): void {
    const source = this.tubes[from];
    const target = this.tubes[to];
    const color = source[source.length - 1];
    source.length -= amount;
    for (let i = 0; i < amount; i++) target.push(color);
    this.codes[from] = this.codes[from].slice(0, source.length);
    this.codes[to] += String.fromCharCode(65 + color).repeat(amount);
  }
}

function* explore(start: readonly (readonly number[])[], capacity: number, budget: number, slice: number): Generator<void, SearchOutcome> {
  const state = new SearchState(start);
  if (isSolved(state.tubes, capacity)) return { kind: "solved", moves: [] };
  const visited = new Set<string>([state.key()]);
  const path: Pour[] = [];
  const stack: { options: Pour[]; next: number }[] = [{ options: availablePours(state.tubes, capacity), next: 0 }];
  let explored = 0;
  let steps = 0;
  while (stack.length > 0) {
    if (slice > 0 && ++steps % slice === 0) yield;
    const frame = stack[stack.length - 1];
    if (frame.next >= frame.options.length) {
      stack.pop();
      const entered = path.pop();
      if (entered) state.revert(entered);
      continue;
    }
    const pour = frame.options[frame.next++];
    state.apply(pour);
    const key = state.key();
    if (visited.has(key)) {
      state.revert(pour);
      continue;
    }
    visited.add(key);
    path.push(pour);
    if (isSolved(state.tubes, capacity)) return { kind: "solved", moves: path.map((p): Move => [p.from, p.to]) };
    if (++explored >= budget) return { kind: "budget" };
    stack.push({ options: availablePours(state.tubes, capacity), next: 0 });
  }
  return { kind: "exhausted" };
}

export function search(start: readonly (readonly number[])[], capacity: number, budget: number): SearchOutcome {
  const run = explore(start, capacity, budget, 0);
  let step = run.next();
  while (!step.done) step = run.next();
  return step.value;
}

export async function searchCooperatively(start: readonly (readonly number[])[], capacity: number, budget: number, slice: number): Promise<SearchOutcome> {
  const run = explore(start, capacity, budget, slice);
  let step = run.next();
  while (!step.done) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    step = run.next();
  }
  return step.value;
}

export function hasMoves(tubes: readonly (readonly number[])[], capacity: number): boolean {
  return tubes.some((_, from) => tubes.some((__, to) => pourAmount(tubes, from, to, capacity) > 0));
}
