import { config } from "../config.js";
import { heartbeat, getHeartbeats } from "./redis.js";
import { brainSettings } from "./settings.js";
import { emitActivity, emitStatusChanged } from "./events.js";
import { pollGmail } from "./connectors/gmail.js";
import { pollCalendar } from "./connectors/calendar.js";
import { ingestTick } from "./ingest.js";
import { googleConfigured, listConnectedEmails } from "./connectors/google-auth.js";
import type { BrainScope } from "./scope.js";
import type { BrainSchedulerName, BrainSettings, SchedulerStatus } from "./types.js";

export interface SchedulerDef {
  name: BrainSchedulerName;
  cadenceMs?: (settings: BrainSettings) => number;
  at?: { hour: number; minute: number };
  initialDelayMs?: number;
  run: (scope: BrainScope) => Promise<string>;
  disabledReason?: (scope: BrainScope) => string | null;
}

function msUntilNext(at: { hour: number; minute: number }): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.brainTz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const nowMinutes = get("hour") * 60 + get("minute");
  const targetMinutes = at.hour * 60 + at.minute;
  const deltaMinutes = ((targetMinutes - nowMinutes + 1440) % 1440) || 1440;
  return Math.max(30_000, deltaMinutes * 60_000 - get("second") * 1000);
}

interface SchedulerState {
  inFlight: boolean;
  lastError: string;
  timer: ReturnType<typeof setTimeout> | null;
  current: Promise<unknown> | null;
}

interface OwnerSchedulers {
  scope: BrainScope;
  states: Map<BrainSchedulerName, SchedulerState>;
  activatedAt: number;
}

const HEARTBEAT_STALE_FACTOR = 3;
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

function newState(): SchedulerState {
  return { inFlight: false, lastError: "", timer: null, current: null };
}

/** Um conjunto de schedulers por brain ativo: timers, execução em voo e último erro nunca se misturam entre donos. */
class BrainSchedulers {
  private defs = new Map<BrainSchedulerName, SchedulerDef>();
  private owners = new Map<string, OwnerSchedulers>();
  private running = false;

  register(def: SchedulerDef): void {
    this.defs.set(def.name, def);
    for (const owner of this.owners.values()) {
      if (!owner.states.has(def.name)) owner.states.set(def.name, newState());
      if (this.running) this.loop(owner.scope, def.name, true);
    }
  }

  activate(scope: BrainScope): void {
    if (this.owners.has(scope.owner)) return;
    const states = new Map<BrainSchedulerName, SchedulerState>();
    for (const name of this.defs.keys()) states.set(name, newState());
    this.owners.set(scope.owner, { scope, states, activatedAt: Date.now() });
    if (this.running) for (const name of this.defs.keys()) this.loop(scope, name, true);
  }

  isActive(owner: string): boolean {
    return this.owners.has(owner);
  }

  activeScopes(): BrainScope[] {
    return [...this.owners.values()].map((entry) => entry.scope);
  }

  async deactivate(owner: string): Promise<void> {
    const entry = this.owners.get(owner);
    if (!entry) return;
    this.owners.delete(owner);
    await this.drain(entry);
  }

  private async drain(entry: OwnerSchedulers): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const state of entry.states.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.current) pending.push(state.current.catch(() => {}));
    }
    await Promise.all(pending);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const entry of this.owners.values()) {
      for (const name of this.defs.keys()) this.loop(entry.scope, name, true);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all([...this.owners.values()].map((entry) => this.drain(entry)));
  }

  private state(scope: BrainScope, name: BrainSchedulerName): SchedulerState | undefined {
    return this.owners.get(scope.owner)?.states.get(name);
  }

  private loop(scope: BrainScope, name: BrainSchedulerName, initial = false): void {
    const def = this.defs.get(name);
    const state = this.state(scope, name);
    if (!def || !state || !this.running) return;
    if (state.timer) clearTimeout(state.timer);
    const target = initial && def.initialDelayMs !== undefined
      ? def.initialDelayMs
      : def.at
        ? msUntilNext(def.at)
        : Math.max(1000, def.cadenceMs?.(brainSettings(scope).get()) ?? 300_000);
    if (target > MAX_TIMER_MS) {
      state.timer = setTimeout(() => this.loop(scope, name), MAX_TIMER_MS);
      state.timer.unref();
      return;
    }
    state.timer = setTimeout(() => {
      void this.fire(scope, name, false).finally(() => this.loop(scope, name));
    }, target);
    state.timer.unref();
  }

  async fire(scope: BrainScope, name: BrainSchedulerName, manual: boolean): Promise<{ ok: boolean; error?: string }> {
    const def = this.defs.get(name);
    const state = this.state(scope, name);
    if (!def || !state) return { ok: false, error: "scheduler desconhecido ou brain inativo" };
    const settings = brainSettings(scope).get();
    if (!manual && !settings.schedulers[name]) return { ok: false, error: "desligado" };
    const disabled = def.disabledReason?.(scope) ?? null;
    if (disabled) {
      state.lastError = disabled;
      return { ok: false, error: disabled };
    }
    if (state.inFlight) return { ok: false, error: "em execução" };
    state.inFlight = true;
    try {
      emitStatusChanged(scope);
      const run = def.run(scope);
      state.current = run;
      const summary = await run;
      if (summary.startsWith("erro:")) {
        state.lastError = summary.slice(5);
        return { ok: false, error: state.lastError };
      }
      state.lastError = "";
      await heartbeat(scope, name);
      return { ok: true };
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[brain:${scope.owner}:${name}] tick falhou:`, state.lastError);
      return { ok: false, error: state.lastError };
    } finally {
      state.inFlight = false;
      state.current = null;
      emitStatusChanged(scope);
    }
  }

  async runNow(scope: BrainScope, name: BrainSchedulerName): Promise<{ ok: boolean; error?: string }> {
    return this.fire(scope, name, true);
  }

  reschedule(scope?: BrainScope): void {
    if (!this.running) return;
    const targets = scope ? [this.owners.get(scope.owner)].filter((e): e is OwnerSchedulers => Boolean(e)) : [...this.owners.values()];
    for (const entry of targets) {
      for (const name of this.defs.keys()) this.loop(entry.scope, name);
    }
  }

  isInFlight(scope: BrainScope, name: BrainSchedulerName): boolean {
    return this.state(scope, name)?.inFlight ?? false;
  }

  lastError(scope: BrainScope, name: BrainSchedulerName): string {
    return this.state(scope, name)?.lastError ?? "";
  }

  names(): BrainSchedulerName[] {
    return [...this.defs.keys()];
  }

  async statuses(scope: BrainScope): Promise<SchedulerStatus[]> {
    const settings = brainSettings(scope).get();
    const names = this.names();
    const beats = await getHeartbeats(scope, names);
    return names.map((name) => {
      const def = this.defs.get(name);
      const state = this.state(scope, name);
      return {
        name,
        enabled: settings.schedulers[name],
        inFlight: state?.inFlight ?? false,
        lastHeartbeat: beats[name],
        lastError: state?.lastError ?? "",
        disabledReason: def?.disabledReason?.(scope) ?? null,
      };
    });
  }

  /** Sem heartbeat ainda, a janela conta da ativação do brain: um brain novo não acusa o digest diário que nem rodou. */
  heartbeatStale(scope: BrainScope, name: BrainSchedulerName, lastHeartbeat: string | null): boolean {
    const since = lastHeartbeat ? new Date(lastHeartbeat).getTime() : (this.owners.get(scope.owner)?.activatedAt ?? 0);
    const def = this.defs.get(name);
    const window = def?.at
      ? 26 * 60 * 60 * 1000
      : (def?.cadenceMs?.(brainSettings(scope).get()) ?? 300_000) * HEARTBEAT_STALE_FACTOR;
    return Date.now() - since > window;
  }
}

export const brainSchedulers = new BrainSchedulers();

function googleDisabledReason(scope: BrainScope): string | null {
  if (!googleConfigured()) return "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes";
  if (listConnectedEmails(scope).length === 0) return "nenhuma conta Google conectada";
  return null;
}

brainSchedulers.register({
  name: "gmail",
  cadenceMs: (s) => s.cadences.gmailMs,
  disabledReason: googleDisabledReason,
  run: async (scope) => {
    const summaries = await pollGmail(scope);
    const emitted = summaries.reduce((acc, s) => acc + s.emitted, 0);
    const errors = summaries.filter((s) => s.error);
    for (const s of errors) {
      emitActivity(scope, { kind: "connector", label: `gmail ${s.account}: ${s.error}` });
    }
    if (emitted > 0) emitActivity(scope, { kind: "connector", label: `gmail: ${emitted} evento(s) novo(s)` });
    return errors.length > 0
      ? `erro:${errors.map((s) => `${s.account}: ${s.error}`).join("; ")}`
      : `${emitted} eventos`;
  },
});

brainSchedulers.register({
  name: "calendar",
  cadenceMs: (s) => s.cadences.calendarMs,
  disabledReason: googleDisabledReason,
  run: async (scope) => {
    const summaries = await pollCalendar(scope);
    const emitted = summaries.reduce((acc, s) => acc + s.emitted, 0);
    const errors = summaries.filter((s) => s.error);
    for (const s of errors) {
      emitActivity(scope, { kind: "connector", label: `calendar ${s.account}: ${s.error}` });
    }
    return errors.length > 0
      ? `erro:${errors.map((s) => `${s.account}: ${s.error}`).join("; ")}`
      : `${emitted} eventos`;
  },
});

brainSchedulers.register({
  name: "ingest",
  cadenceMs: (s) => s.cadences.ingestMs,
  run: async (scope) => {
    const { processed } = await ingestTick(scope);
    return `${processed} processados`;
  },
});
