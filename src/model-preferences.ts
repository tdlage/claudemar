import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "./config.js";

type Preferences = Record<string, string>;

const PERSIST_DEBOUNCE_MS = 1000;

class ModelPreferences {
  private prefs: Preferences = {};
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  private filePath(): string {
    return resolve(config.dataPath, "model-preferences.json");
  }

  private load(): void {
    const path = this.filePath();
    if (!existsSync(path)) return;
    try {
      this.prefs = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // corrupted, start fresh
    }
  }

  reload(): void {
    this.prefs = {};
    this.load();
  }

  private targetKey(targetType: string, targetName: string): string {
    return `${targetType}:${targetName}`;
  }

  getLastModel(targetType: string, targetName: string): string | undefined {
    return this.prefs[this.targetKey(targetType, targetName)];
  }

  setLastModel(targetType: string, targetName: string, model: string): void {
    this.prefs[this.targetKey(targetType, targetName)] = model;
    this.schedulePersist();
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
    writeFile(tmp, JSON.stringify(this.prefs, null, 2), "utf-8")
      .then(() => rename(tmp, target))
      .catch((err) => console.error("[model-preferences] persist failed:", err));
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const target = this.filePath();
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.prefs, null, 2), "utf-8");
      renameSync(tmp, target);
    } catch (err) {
      console.error("[model-preferences] flush failed:", err);
    }
  }
}

export const modelPreferences = new ModelPreferences();
