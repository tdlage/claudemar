import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";
import {
  getDefaultProjectModel,
  isSelectableProjectModel,
  normalizeModel,
} from "./models-discovery.js";
import type { LlmProfile } from "./providers/llm.js";

interface ProjectSettings {
  models: Record<string, string>;
}

type ProjectSettingsStore = Record<string, ProjectSettings>;

export class ProjectSettingsManager {
  private data: ProjectSettingsStore = {};
  private persister: JsonPersister;

  constructor(filePath = resolve(config.dataPath, "project-settings.json")) {
    this.persister = new JsonPersister(filePath, "project-settings");
    this.applyFromDisk();
  }

  private applyFromDisk(): void {
    const raw = this.persister.readSync();
    if (!raw || typeof raw !== "object") return;
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const models: Record<string, string> = {};
      if (entry.models && typeof entry.models === "object") {
        for (const [profileId, stored] of Object.entries(entry.models as Record<string, unknown>)) {
          if (typeof stored === "string" && this.isStoredModel(stored)) models[profileId] = normalizeModel(stored);
        }
      }
      const legacyModel = typeof entry.model === "string" ? normalizeModel(entry.model) : "";
      if (isSelectableProjectModel(legacyModel)) models.anthropic = legacyModel;
      if (Object.keys(models).length > 0) this.data[name] = { models };
    }
  }

  private isStoredModel(model: string): boolean {
    return model.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model);
  }

  getModel(projectName: string, profile?: LlmProfile): string {
    const profileId = profile?.id ?? "anthropic";
    return this.data[projectName]?.models[profileId] ?? getDefaultProjectModel(profile);
  }

  setModel(projectName: string, model: string, profile?: LlmProfile): void {
    if (!isSelectableProjectModel(model, profile)) {
      throw new Error(`Invalid project model: ${model}`);
    }
    const profileId = profile?.id ?? "anthropic";
    const defaultModel = getDefaultProjectModel(profile);
    const models = { ...(this.data[projectName]?.models ?? {}) };
    if (model === defaultModel) {
      delete models[profileId];
    } else {
      models[profileId] = model;
    }
    if (Object.keys(models).length === 0) delete this.data[projectName];
    else this.data[projectName] = { models };
    this.persister.scheduleWrite(() => this.data);
  }

  removeProject(projectName: string): void {
    if (!(projectName in this.data)) return;
    delete this.data[projectName];
    this.persister.scheduleWrite(() => this.data);
  }

  flush(): void {
    this.persister.flushSync(this.data);
  }
}

export const projectSettingsManager = new ProjectSettingsManager();
