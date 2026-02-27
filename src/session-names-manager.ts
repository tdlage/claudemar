import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";

interface PersistedData {
  nextNumber: number;
  userCounters: Record<string, number>;
  names: Record<string, string>;
}

class SessionNamesManager {
  private nextNumber = 1;
  private userCounters = new Map<string, number>();
  private names = new Map<string, string>();
  private persister = new JsonPersister(resolve(config.dataPath, "session-names.json"), "session-names");

  constructor() {
    this.applyFromDisk();
  }

  private applyFromDisk(): void {
    const data = this.persister.readSync() as PersistedData | null;
    if (!data) return;
    this.nextNumber = data.nextNumber ?? 1;
    for (const [user, count] of Object.entries(data.userCounters ?? {})) {
      this.userCounters.set(user, count);
    }
    for (const [sid, name] of Object.entries(data.names ?? {})) {
      this.names.set(sid, name);
    }
  }

  private toJSON(): PersistedData {
    return {
      nextNumber: this.nextNumber,
      userCounters: Object.fromEntries(this.userCounters),
      names: Object.fromEntries(this.names),
    };
  }

  reload(): void {
    this.nextNumber = 1;
    this.userCounters.clear();
    this.names.clear();
    this.applyFromDisk();
  }

  getName(sessionId: string): string | undefined {
    return this.names.get(sessionId);
  }

  setName(sessionId: string, name: string): void {
    this.names.set(sessionId, name);
    this.persister.scheduleWrite(() => this.toJSON());
  }

  getNextAutoName(username?: string): string {
    const label = this.formatLabel(username);
    const counter = (this.userCounters.get(label) ?? 0) + 1;
    this.userCounters.set(label, counter);
    const name = `${label} ${counter}`;
    this.persister.scheduleWrite(() => this.toJSON());
    return name;
  }

  private formatLabel(username?: string): string {
    if (!username || username === "admin") return "Admin";
    if (username === "telegram") return "Telegram";
    if (username === "system") return "System";
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  getNames(sessionIds: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const sid of sessionIds) {
      const name = this.names.get(sid);
      if (name) result[sid] = name;
    }
    return result;
  }

  getAllNames(): Record<string, string> {
    return Object.fromEntries(this.names);
  }

  flush(): void {
    this.persister.flushSync(this.toJSON());
  }
}

export const sessionNamesManager = new SessionNamesManager();
