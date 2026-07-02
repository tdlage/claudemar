import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";
import { DEFAULT_PROJECT_MODEL, isSelectableProjectModel } from "./models-discovery.js";

interface ProjectSettings {
  model: string;
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
      const model = (value as Record<string, unknown>).model;
      if (isSelectableProjectModel(model)) this.data[name] = { model };
    }
  }

  getModel(projectName: string): string {
    return this.data[projectName]?.model ?? DEFAULT_PROJECT_MODEL;
  }

  setModel(projectName: string, model: string): void {
    if (!isSelectableProjectModel(model)) {
      throw new Error(`Invalid project model: ${model}`);
    }
    if (model === DEFAULT_PROJECT_MODEL) {
      delete this.data[projectName];
    } else {
      this.data[projectName] = { model };
    }
    this.persister.scheduleWrite(() => this.data);
  }

  flush(): void {
    this.persister.flushSync(this.data);
  }
}

export const projectSettingsManager = new ProjectSettingsManager();
