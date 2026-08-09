import { config } from "../config.js";
import { heartbeat, getHeartbeats } from "./redis.js";
import { brainSettingsManager } from "./settings.js";
import { emitActivity, emitStatusChanged } from "./events.js";
import { pollGmail } from "./connectors/gmail.js";
import { pollCalendar } from "./connectors/calendar.js";
import { ingestTick } from "./ingest.js";
import { googleConfigured, listConnectedEmails } from "./connectors/google-auth.js";
import type { BrainSchedulerName, BrainSettings, SchedulerStatus } from "./types.js";

export interface SchedulerDef {
  name: BrainSchedulerName;
  cadenceMs?: (settings: BrainSettings) => number;
  at?: { hour: number; minute: number };
  run: () => Promise<string>;
  disabledReason?: () => string | null;
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

const HEARTBEAT_STALE_FACTOR = 3;
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

class BrainSchedulers {
  private defs = new Map<BrainSchedulerName, SchedulerDef>();
  private states = new Map<BrainSchedulerName, SchedulerState>();
  private running = false;

  register(def: SchedulerDef): void {
    this.defs.set(def.name, def);
    if (!this.states.has(def.name)) {
      this.states.set(def.name, { inFlight: false, lastError: "", timer: null, current: null });
    }
    if (this.running) this.loop(def.name);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const name of this.defs.keys()) this.loop(name);
  }

  async stop(): Promise<void> {
    this.running = false;
    const pending: Promise<unknown>[] = [];
    for (const state of this.states.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.current) pending.push(state.current.catch(() => {}));
    }
    await Promise.all(pending);
  }

  private loop(name: BrainSchedulerName): void {
    const def = this.defs.get(name);
    const state = this.states.get(name);
    if (!def || !state || !this.running) return;
    if (state.timer) clearTimeout(state.timer);
    const target = def.at
      ? msUntilNext(def.at)
      : Math.max(1000, def.cadenceMs?.(brainSettingsManager.get()) ?? 300_000);
    if (target > MAX_TIMER_MS) {
      state.timer = setTimeout(() => this.loop(name), MAX_TIMER_MS);
      state.timer.unref();
      return;
    }
    state.timer = setTimeout(() => {
      void this.fire(name, false).finally(() => this.loop(name));
    }, target);
    state.timer.unref();
  }

  async fire(name: BrainSchedulerName, manual: boolean): Promise<{ ok: boolean; error?: string }> {
    const def = this.defs.get(name);
    const state = this.states.get(name);
    if (!def || !state) return { ok: false, error: "scheduler desconhecido" };
    const settings = brainSettingsManager.get();
    if (!manual && !settings.schedulers[name]) return { ok: false, error: "desligado" };
    const disabled = def.disabledReason?.() ?? null;
    if (disabled) {
      state.lastError = disabled;
      return { ok: false, error: disabled };
    }
    if (state.inFlight) return { ok: false, error: "em execução" };
    state.inFlight = true;
    try {
      emitStatusChanged();
      const run = def.run();
      state.current = run;
      const summary = await run;
      if (summary.startsWith("erro:")) {
        state.lastError = summary.slice(5);
        return { ok: false, error: state.lastError };
      }
      state.lastError = "";
      await heartbeat(name);
      return { ok: true };
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[brain:${name}] tick falhou:`, state.lastError);
      return { ok: false, error: state.lastError };
    } finally {
      state.inFlight = false;
      state.current = null;
      emitStatusChanged();
    }
  }

  async runNow(name: BrainSchedulerName): Promise<{ ok: boolean; error?: string }> {
    return this.fire(name, true);
  }

  reschedule(): void {
    if (!this.running) return;
    for (const name of this.defs.keys()) this.loop(name);
  }

  isInFlight(name: BrainSchedulerName): boolean {
    return this.states.get(name)?.inFlight ?? false;
  }

  names(): BrainSchedulerName[] {
    return [...this.defs.keys()];
  }

  async statuses(): Promise<SchedulerStatus[]> {
    const settings = brainSettingsManager.get();
    const names = this.names();
    const beats = await getHeartbeats(names);
    return names.map((name) => {
      const def = this.defs.get(name);
      const state = this.states.get(name);
      return {
        name,
        enabled: settings.schedulers[name],
        inFlight: state?.inFlight ?? false,
        lastHeartbeat: beats[name],
        lastError: state?.lastError ?? "",
        disabledReason: def?.disabledReason?.() ?? null,
      };
    });
  }

  heartbeatStale(name: BrainSchedulerName, lastHeartbeat: string | null): boolean {
    if (!lastHeartbeat) return true;
    const def = this.defs.get(name);
    const window = def?.at ? 26 * 60 * 60 * 1000 : (def?.cadenceMs?.(brainSettingsManager.get()) ?? 300_000) * HEARTBEAT_STALE_FACTOR;
    return Date.now() - new Date(lastHeartbeat).getTime() > window;
  }
}

export const brainSchedulers = new BrainSchedulers();

function googleDisabledReason(): string | null {
  if (!googleConfigured()) return "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes";
  if (listConnectedEmails().length === 0) return "nenhuma conta Google conectada";
  return null;
}

brainSchedulers.register({
  name: "gmail",
  cadenceMs: (s) => s.cadences.gmailMs,
  disabledReason: googleDisabledReason,
  run: async () => {
    const summaries = await pollGmail();
    const emitted = summaries.reduce((acc, s) => acc + s.emitted, 0);
    const errors = summaries.filter((s) => s.error);
    for (const s of errors) {
      emitActivity({ kind: "connector", label: `gmail ${s.account}: ${s.error}` });
    }
    if (emitted > 0) emitActivity({ kind: "connector", label: `gmail: ${emitted} evento(s) novo(s)` });
    return errors.length > 0
      ? `erro:${errors.map((s) => `${s.account}: ${s.error}`).join("; ")}`
      : `${emitted} eventos`;
  },
});

brainSchedulers.register({
  name: "calendar",
  cadenceMs: (s) => s.cadences.calendarMs,
  disabledReason: googleDisabledReason,
  run: async () => {
    const summaries = await pollCalendar();
    const emitted = summaries.reduce((acc, s) => acc + s.emitted, 0);
    const errors = summaries.filter((s) => s.error);
    for (const s of errors) {
      emitActivity({ kind: "connector", label: `calendar ${s.account}: ${s.error}` });
    }
    return errors.length > 0
      ? `erro:${errors.map((s) => `${s.account}: ${s.error}`).join("; ")}`
      : `${emitted} eventos`;
  },
});

brainSchedulers.register({
  name: "ingest",
  cadenceMs: (s) => s.cadences.ingestMs,
  run: async () => {
    const { processed } = await ingestTick();
    return `${processed} processados`;
  },
});
