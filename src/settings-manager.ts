import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "./config.js";

export interface RuntimeSettings {
  sesFrom: string;
  adminEmail: string;
}

const PERSIST_DEBOUNCE_MS = 1000;

class SettingsManager {
  private data: RuntimeSettings = {
    sesFrom: config.sesFrom,
    adminEmail: config.adminEmail,
  };
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  private filePath(): string {
    return resolve(config.dataPath, "settings.json");
  }

  private load(): void {
    const path = this.filePath();
    if (!existsSync(path)) return;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (typeof raw.sesFrom === "string") this.data.sesFrom = raw.sesFrom;
      if (typeof raw.adminEmail === "string") this.data.adminEmail = raw.adminEmail;
    } catch {
      // corrupted file, keep env defaults
    }
  }

  get(): RuntimeSettings {
    return { ...this.data };
  }

  update(patch: Partial<RuntimeSettings>): void {
    if (patch.sesFrom !== undefined) this.data.sesFrom = patch.sesFrom;
    if (patch.adminEmail !== undefined) this.data.adminEmail = patch.adminEmail;
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
    writeFile(tmp, JSON.stringify(this.data, null, 2), "utf-8")
      .then(() => rename(tmp, target))
      .catch((err) => console.error("[settings] persist failed:", err));
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const target = this.filePath();
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
      renameSync(tmp, target);
    } catch (err) {
      console.error("[settings] flush failed:", err);
    }
  }
}

export const settingsManager = new SettingsManager();
