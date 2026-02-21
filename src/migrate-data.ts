import { existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const DATA_FILES = [
  "sessions.json", "queue.json", "run-configs.json", "run-processes.json",
  "metrics.json", "session-names.json", "users.json", "settings.json",
  "schedules.json", "history.jsonl", "secrets.json",
];

for (const file of DATA_FILES) {
  const legacy = resolve(config.basePath, file);
  const target = resolve(config.dataPath, file);
  if (existsSync(legacy) && !existsSync(target)) {
    renameSync(legacy, target);
    console.log(`[migration] Moved ${file} → data/${file}`);
  }
}
