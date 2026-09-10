import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { config } from "./config.js";
import { projectSettingsManager } from "./project-settings.js";
import { settingsManager } from "./settings-manager.js";
import { resolveAvailableModel } from "./provider-catalog.js";

export class TargetModelSettings {
  constructor(private file = resolve(config.dataPath, "target-models.json")) {}

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    const value: unknown = JSON.parse(readFileSync(this.file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Preferências de modelo inválidas.");
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }

  get(type: string, name: string): string | undefined {
    return this.read()[JSON.stringify([type, name])];
  }

  set(type: string, name: string, model?: string): void {
    const data = this.read();
    const key = JSON.stringify([type, name]);
    if (data[key] === model) return;
    if (model) data[key] = model;
    else delete data[key];
    writeFileSync(this.file + ".tmp", JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(this.file + ".tmp", this.file);
  }
}

export const targetModelSettings = new TargetModelSettings();
export class SessionModelSettings {
  constructor(private directory = resolve(config.dataPath, "session-models")) {}

  private file(sessionId: string): string {
    return resolve(this.directory, createHash("sha256").update(sessionId).digest("hex") + ".json");
  }

  get(sessionId: string): string | undefined {
    const file = this.file(sessionId);
    if (!existsSync(file)) return undefined;
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof value === "string" ? value : undefined;
  }

  set(sessionId: string, selection: string): void {
    if (this.get(sessionId) === selection) return;
    mkdirSync(this.directory, { recursive: true });
    const file = this.file(sessionId);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(selection), { mode: 0o600 });
    renameSync(temporary, file);
  }
}

export const sessionModelSettings = new SessionModelSettings();

export function resolveTargetModel(type: string, name: string, explicit?: string) {
  const selected = explicit || targetModelSettings.get(type, name);
  if (selected) return resolveAvailableModel(selected);
  if (type === "project") {
    try {
      const legacyProfile = settingsManager.getActiveProfile();
      const model = projectSettingsManager.getModel(name, legacyProfile);
      const resolved = resolveAvailableModel(`${encodeURIComponent(legacyProfile.id)}::${model}`);
      targetModelSettings.set(type, name, resolved.selection);
      return resolved;
    } catch { /* legacy provider may no longer be configured */ }
  }
  return resolveAvailableModel();
}
