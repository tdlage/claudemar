import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

export interface OrchestratorSettings {
  prependPrompt: string;
  model: string;
}

const DEFAULTS: OrchestratorSettings = {
  prependPrompt: "",
  model: "claude-opus-4-6",
};

function settingsPath(): string {
  return resolve(config.orchestratorPath, "settings.json");
}

export function loadOrchestratorSettings(): OrchestratorSettings {
  try {
    const raw = readFileSync(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      prependPrompt: typeof parsed.prependPrompt === "string" ? parsed.prependPrompt : DEFAULTS.prependPrompt,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULTS.model,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveOrchestratorSettings(settings: OrchestratorSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}
