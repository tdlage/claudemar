import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";
import { DEFAULT_ZAI_MODEL, LLM_PROVIDERS, type LlmProvider } from "./providers/llm.js";

export interface RuntimeSettings {
  sesFrom: string;
  adminEmail: string;
  llmProvider: LlmProvider;
  zaiModel: string;
}

function defaults(): RuntimeSettings {
  return { sesFrom: config.sesFrom, adminEmail: config.adminEmail, llmProvider: "anthropic", zaiModel: DEFAULT_ZAI_MODEL };
}

class SettingsManager {
  private data: RuntimeSettings = defaults();
  private persister = new JsonPersister(resolve(config.dataPath, "settings.json"), "settings");

  constructor() {
    this.applyFromDisk();
  }

  private applyFromDisk(): void {
    const raw = this.persister.readSync() as Record<string, unknown> | null;
    if (!raw) return;
    if (typeof raw.sesFrom === "string") this.data.sesFrom = raw.sesFrom;
    if (typeof raw.adminEmail === "string") this.data.adminEmail = raw.adminEmail;
    if (raw.llmProvider === "anthropic" || raw.llmProvider === "zai") this.data.llmProvider = raw.llmProvider;
    if (typeof raw.zaiModel === "string") this.data.zaiModel = raw.zaiModel;
  }

  reload(): void {
    this.data = defaults();
    this.applyFromDisk();
  }

  get(): RuntimeSettings {
    return { ...this.data };
  }

  update(patch: Partial<RuntimeSettings>): void {
    if (patch.sesFrom !== undefined) this.data.sesFrom = patch.sesFrom;
    if (patch.adminEmail !== undefined) this.data.adminEmail = patch.adminEmail;
    if (patch.llmProvider !== undefined && LLM_PROVIDERS.includes(patch.llmProvider)) this.data.llmProvider = patch.llmProvider;
    if (patch.zaiModel !== undefined) this.data.zaiModel = patch.zaiModel.trim();
    this.persister.scheduleWrite(() => this.data);
  }

  flush(): void {
    this.persister.flushSync(this.data);
  }
}

export const settingsManager = new SettingsManager();
