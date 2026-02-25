import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";

export interface RuntimeSettings {
  sesFrom: string;
  adminEmail: string;
}

class SettingsManager {
  private data: RuntimeSettings = { sesFrom: config.sesFrom, adminEmail: config.adminEmail };
  private persister = new JsonPersister(resolve(config.dataPath, "settings.json"), "settings");

  constructor() {
    this.applyFromDisk();
  }

  private applyFromDisk(): void {
    const raw = this.persister.readSync() as Record<string, unknown> | null;
    if (!raw) return;
    if (typeof raw.sesFrom === "string") this.data.sesFrom = raw.sesFrom;
    if (typeof raw.adminEmail === "string") this.data.adminEmail = raw.adminEmail;
  }

  reload(): void {
    this.data = { sesFrom: config.sesFrom, adminEmail: config.adminEmail };
    this.applyFromDisk();
  }

  get(): RuntimeSettings {
    return { ...this.data };
  }

  update(patch: Partial<RuntimeSettings>): void {
    if (patch.sesFrom !== undefined) this.data.sesFrom = patch.sesFrom;
    if (patch.adminEmail !== undefined) this.data.adminEmail = patch.adminEmail;
    this.persister.scheduleWrite(() => this.data);
  }

  flush(): void {
    this.persister.flushSync(this.data);
  }
}

export const settingsManager = new SettingsManager();
