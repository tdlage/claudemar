export type Tube = number[];
export type Move = [from: number, to: number];
export type Availability = "playable" | "awaiting-input" | "not-running";

export interface GameView {
  level: number;
  maxLevel: number;
  levelsCompleted: number;
  capacity: number;
  tubes: Tube[];
  moves: Move[];
  moveLimit: number;
  status: "playing" | "stuck" | "exhausted";
}

export interface CompletedLevel {
  level: number;
  moves: number;
  record: boolean;
}

export type Verdict = "solvable" | "unsolvable" | "unknown";

export interface CheckResponse {
  verdict: Verdict;
  level: number;
  moves: number;
}

export interface GameSnapshotResponse {
  state: GameView;
  availability: Availability;
}

export interface GameMutationResponse {
  state: GameView;
  completed: CompletedLevel | null;
}

export interface RankingEntry {
  position: number;
  name: string;
  maxLevel: number;
  levelsCompleted: number;
  reachedAt: string;
  me: boolean;
}

export interface Ranking {
  entries: RankingEntry[];
  me: RankingEntry | null;
  total: number;
}
