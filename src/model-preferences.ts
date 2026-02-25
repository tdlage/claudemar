import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";

type Preferences = Record<string, string>;

class ModelPreferences {
  private prefs: Preferences = {};
  private persister = new JsonPersister(resolve(config.dataPath, "model-preferences.json"), "model-preferences");

  constructor() {
    const raw = this.persister.readSync() as Preferences | null;
    if (raw) this.prefs = raw;
  }

  reload(): void {
    this.prefs = {};
    const raw = this.persister.readSync() as Preferences | null;
    if (raw) this.prefs = raw;
  }

  private targetKey(targetType: string, targetName: string): string {
    return `${targetType}:${targetName}`;
  }

  getLastModel(targetType: string, targetName: string): string | undefined {
    return this.prefs[this.targetKey(targetType, targetName)];
  }

  setLastModel(targetType: string, targetName: string, model: string): void {
    this.prefs[this.targetKey(targetType, targetName)] = model;
    this.persister.scheduleWrite(() => this.prefs);
  }

  flush(): void {
    this.persister.flushSync(this.prefs);
  }
}

export const modelPreferences = new ModelPreferences();
