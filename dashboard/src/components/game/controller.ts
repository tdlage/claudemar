import { ApiError, api } from "../../lib/api";
import { isComplete, isSolved, pourAmount, replay, transfer, type PourRecord } from "./engine";
import type { BoardRenderer } from "./renderer";
import { GameAudio, vibrate } from "./sound";
import type { Availability, CheckResponse, CompletedLevel, GameMutationResponse, GameSnapshotResponse, GameView, Move, Tube, Verdict } from "./types";

export type GamePhase = "loading" | "playing" | "celebrating" | "won" | "stuck";
export type Unavailable = Exclude<Availability, "playable">;

export interface GameSnapshot {
  phase: GamePhase;
  level: number;
  maxLevel: number;
  levelsCompleted: number;
  moves: number;
  moveLimit: number;
  exhausted: boolean;
  selected: number | null;
  tubes: Tube[];
  capacity: number;
  completed: CompletedLevel | null;
  nextReady: boolean;
  verdict: Verdict | "checking" | null;
  error: string | null;
}

const INITIAL: GameSnapshot = {
  phase: "loading",
  level: 1,
  maxLevel: 1,
  levelsCompleted: 0,
  moves: 0,
  moveLimit: 0,
  exhausted: false,
  selected: null,
  tubes: [],
  capacity: 4,
  completed: null,
  nextReady: false,
  verdict: null,
  error: null,
};

const CONNECTION_ERROR = "Não foi possível falar com o servidor. A jogada pode não ter sido salva.";

function isUnavailable(value: unknown): value is Unavailable {
  return value === "awaiting-input" || value === "not-running";
}

function sameMoves(moves: readonly Move[], history: readonly PourRecord[]): boolean {
  return moves.length === history.length && moves.every(([from, to], i) => history[i].from === from && history[i].to === to);
}

export class DecantaController {
  private snapshot: GameSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly audio: GameAudio;
  private renderer: BoardRenderer | null = null;
  private start: Tube[] = [];
  private history: PourRecord[] = [];
  private requests: Promise<void> = Promise.resolve();
  private generation = 0;
  private revision = 0;
  private next: GameView | null = null;
  private loaded = false;
  private active = false;
  private readonly execId: string;
  private unavailable: (reason: Unavailable) => void = () => {};

  constructor(execId: string, muted: boolean) {
    this.execId = execId;
    this.audio = new GameAudio(muted);
  }

  onUnavailable(handler: (reason: Unavailable) => void): void {
    this.unavailable = handler;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameSnapshot => this.snapshot;

  connect(): void {
    this.active = true;
  }

  disconnect(): void {
    this.active = false;
    this.generation += 1;
    this.audio.dispose();
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  playPour(durationMs: number, fillFrom: number, fillTo: number): void {
    this.audio.pour(durationMs, fillFrom, fillTo);
  }

  playSeal(): void {
    this.audio.seal();
    vibrate(18);
  }

  attach(renderer: BoardRenderer | null): void {
    this.renderer = renderer;
    if (renderer && this.loaded) renderer.load(this.snapshot.tubes, this.snapshot.capacity, true);
  }

  refresh(): Promise<void> {
    this.requests = this.requests.then(async () => {
      if (!this.active) return;
      try {
        const { state, availability } = await api.get<GameSnapshotResponse>(`/game?execId=${encodeURIComponent(this.execId)}`);
        if (!this.active) return;
        if (isUnavailable(availability)) this.unavailable(availability);
        const unchanged = this.loaded && this.matches(state);
        if (unchanged) this.update({ maxLevel: state.maxLevel, levelsCompleted: state.levelsCompleted, error: null });
        else this.apply(state, !this.loaded);
      } catch (err) {
        if (this.active) this.update({ error: err instanceof Error ? err.message : CONNECTION_ERROR });
      }
    });
    return this.requests;
  }

  tap(index: number): void {
    const state = this.snapshot;
    const renderer = this.renderer;
    const tube = state.tubes[index];
    if (state.phase !== "playing" || !renderer || !tube) return;
    if (state.selected === null) {
      if (tube.length === 0 || isComplete(tube, state.capacity)) return this.refuse(index);
      this.select(index);
      this.audio.select();
      vibrate(8);
      return;
    }
    if (state.selected === index) {
      this.select(null);
      this.audio.deselect();
      return;
    }
    const from = state.selected;
    if (this.history.length >= state.moveLimit) {
      this.select(null);
      this.update({ phase: "stuck", exhausted: true, verdict: null });
      return;
    }
    const amount = pourAmount(state.tubes, from, index, state.capacity);
    if (amount === 0) {
      this.select(null);
      return this.refuse(from);
    }
    const tubes = transfer(state.tubes, from, index, amount);
    const moveIndex = this.history.length;
    this.history.push({ from, to: index, amount });
    this.revision += 1;
    renderer.select(null);
    const animation = renderer.pour(from, index, amount);
    const solved = isSolved(tubes, state.capacity);
    this.update({ tubes, selected: null, moves: this.history.length, phase: solved ? "celebrating" : "playing", verdict: null });
    this.mutate("move", { from, to: index, index: moveIndex }, (response) => this.settle(response));
    if (solved) void this.celebrate(animation);
  }

  undo(): void {
    const state = this.snapshot;
    const renderer = this.renderer;
    const last = this.history[this.history.length - 1];
    if (!renderer || !last || (state.phase !== "playing" && state.phase !== "stuck")) return;
    this.history.pop();
    this.revision += 1;
    renderer.select(null);
    void renderer.rewind(last.from, last.to, last.amount);
    const tubes = transfer(state.tubes, last.to, last.from, last.amount);
    this.update({ tubes, selected: null, moves: this.history.length, phase: "playing", exhausted: false, verdict: null, error: null });
    this.audio.undo();
    vibrate(8);
    this.mutate("undo", { index: this.history.length }, (response) => this.settle(response));
  }

  check(): void {
    const state = this.snapshot;
    if (state.phase !== "playing" || state.verdict === "checking") return;
    const revision = this.revision;
    this.update({ verdict: "checking", error: null });
    this.mutate<CheckResponse>("check", { level: state.level, moves: this.history.length }, (response) => {
      if (revision === this.revision) this.update({ verdict: response.verdict });
    });
  }

  dismissVerdict(): void {
    if (this.snapshot.verdict !== null && this.snapshot.verdict !== "checking") this.update({ verdict: null });
  }

  restart(): void {
    const state = this.snapshot;
    if (!this.renderer || (state.phase !== "playing" && state.phase !== "stuck")) return;
    this.generation += 1;
    this.history = [];
    const tubes = this.start.map((tube) => tube.slice());
    this.renderer.load(tubes, state.capacity, true);
    this.update({ tubes, selected: null, moves: 0, phase: "playing", exhausted: false, verdict: null, error: null });
    this.mutate("restart", {}, (response) => this.settle(response));
  }

  chooseLevel(level: number): void {
    if (this.snapshot.phase === "celebrating" || this.snapshot.phase === "loading") return;
    this.generation += 1;
    this.renderer?.select(null);
    this.update({ phase: "loading", selected: null, completed: null, nextReady: false, verdict: null, error: null });
    this.mutate("level", { level }, (response) => this.apply(response.state, true));
  }

  advance(): void {
    if (this.snapshot.phase !== "won" || !this.next) return;
    this.apply(this.next, true);
  }

  deselect(): boolean {
    if (this.snapshot.selected === null) return false;
    this.select(null);
    this.audio.deselect();
    return true;
  }

  private update(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private matches(view: GameView): boolean {
    return view.level === this.snapshot.level && sameMoves(view.moves, this.history);
  }

  private select(index: number | null): void {
    this.renderer?.select(index);
    this.update({ selected: index });
  }

  private refuse(index: number): void {
    this.renderer?.reject(index);
    this.audio.invalid();
    vibrate([10, 40, 10]);
  }

  private apply(view: GameView, intro: boolean): void {
    this.generation += 1;
    this.loaded = true;
    this.next = null;
    this.start = view.tubes.map((tube) => tube.slice());
    const { tubes, history } = replay(view.tubes, view.moves, view.capacity);
    this.history = history;
    this.update({
      phase: view.status === "playing" ? "playing" : "stuck",
      exhausted: view.status === "exhausted",
      moveLimit: view.moveLimit,
      level: view.level,
      maxLevel: view.maxLevel,
      levelsCompleted: view.levelsCompleted,
      moves: history.length,
      selected: null,
      tubes,
      capacity: view.capacity,
      completed: null,
      nextReady: false,
      verdict: null,
      error: null,
    });
    this.renderer?.load(tubes, view.capacity, intro);
  }

  private mutate<T = GameMutationResponse>(action: string, body: Record<string, unknown>, handle: (response: T) => void): void {
    const generation = this.generation;
    this.requests = this.requests.then(async () => {
      if (!this.active || generation !== this.generation) return;
      try {
        const response = await api.post<T>(`/game/${action}`, { execId: this.execId, ...body });
        if (this.active && generation === this.generation) handle(response);
      } catch (err) {
        if (this.active) this.recover(err);
      }
    });
  }

  private recover(err: unknown): void {
    if (this.snapshot.verdict === "checking") this.update({ verdict: null });
    if (err instanceof ApiError) {
      if (isUnavailable(err.body.availability)) {
        this.generation += 1;
        this.unavailable(err.body.availability);
        return;
      }
      const state = err.body.state as GameView | undefined;
      if (state) {
        this.apply(state, false);
        return;
      }
    }
    this.update({ error: CONNECTION_ERROR });
  }

  private settle(response: GameMutationResponse): void {
    if (response.completed) {
      this.next = response.state;
      this.update({
        completed: response.completed,
        nextReady: true,
        maxLevel: response.state.maxLevel,
        levelsCompleted: response.state.levelsCompleted,
      });
      return;
    }
    if (!this.matches(response.state)) return;
    this.update({ error: null });
    if (response.state.status !== "playing") void this.declareStuck(response.state.status === "exhausted");
  }

  private async declareStuck(exhausted: boolean): Promise<void> {
    const generation = this.generation;
    const revision = this.revision;
    await this.renderer?.idle();
    if (generation !== this.generation || revision !== this.revision || this.snapshot.phase !== "playing") return;
    this.select(null);
    this.update({ phase: "stuck", exhausted, verdict: null });
    this.audio.stuck();
    vibrate([30, 60, 30]);
  }

  private async celebrate(animation: Promise<void>): Promise<void> {
    const generation = this.generation;
    await animation;
    await this.renderer?.idle();
    if (generation !== this.generation) return;
    this.renderer?.celebrate();
    this.audio.win();
    vibrate([30, 50, 30, 50, 90]);
    const state = this.snapshot;
    this.update({
      phase: "won",
      completed: state.completed ?? { level: state.level, moves: this.history.length, record: state.level + 1 > state.maxLevel },
    });
  }
}
