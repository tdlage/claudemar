import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "./config.js";

interface PersistedData {
  nextNumber: number;
  names: Record<string, string>;
}

const PERSIST_DEBOUNCE_MS = 1000;

class SessionNamesManager {
  private nextNumber = 1;
  private names = new Map<string, string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  private filePath(): string {
    return resolve(config.dataPath, "session-names.json");
  }

  private load(): void {
    const path = this.filePath();
    if (!existsSync(path)) return;
    try {
      const data: PersistedData = JSON.parse(readFileSync(path, "utf-8"));
      this.nextNumber = data.nextNumber ?? 1;
      for (const [sid, name] of Object.entries(data.names ?? {})) {
        this.names.set(sid, name);
      }
    } catch {
      // corrupted, start fresh
    }
  }

  getName(sessionId: string): string | undefined {
    return this.names.get(sessionId);
  }

  setName(sessionId: string, name: string): void {
    this.names.set(sessionId, name);
    this.schedulePersist();
  }

  getNextAutoName(): string {
    const name = `Session ${this.nextNumber}`;
    this.nextNumber++;
    this.schedulePersist();
    return name;
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

  private toJSON(): PersistedData {
    return {
      nextNumber: this.nextNumber,
      names: Object.fromEntries(this.names),
    };
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persist(): void {
    const target = this.filePath();
    const tmp = target + ".tmp";
    writeFile(tmp, JSON.stringify(this.toJSON(), null, 2), "utf-8")
      .then(() => rename(tmp, target))
      .catch((err) => console.error("[session-names] persist failed:", err));
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const target = this.filePath();
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.toJSON(), null, 2), "utf-8");
      renameSync(tmp, target);
    } catch (err) {
      console.error("[session-names] flush failed:", err);
    }
  }
}

export const sessionNamesManager = new SessionNamesManager();
