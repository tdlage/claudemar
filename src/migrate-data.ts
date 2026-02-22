import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

function moveEntry(src: string, dest: string, label: string): void {
  try {
    renameSync(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "EXDEV") throw err;
    cpSync(src, dest, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
  console.log(`[migration] Moved ${label} → ${dest}`);
}

function isDirEmpty(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

if (config.installDir !== config.basePath) {
  mkdirSync(config.basePath, { recursive: true });

  const DIRS_TO_MIGRATE = ["data", "agents", "projects", "orchestrator"];
  for (const dir of DIRS_TO_MIGRATE) {
    const oldDir = resolve(config.installDir, dir);
    const newDir = resolve(config.basePath, dir);
    if (existsSync(oldDir) && (!existsSync(newDir) || isDirEmpty(newDir))) {
      if (isDirEmpty(newDir)) rmSync(newDir, { recursive: true, force: true });
      moveEntry(oldDir, newDir, `${dir}/`);
    }
  }

  const FILES_TO_MIGRATE = ["send-email.sh", ".sync-agents.lock", ".update-notified"];
  for (const file of FILES_TO_MIGRATE) {
    const oldFile = resolve(config.installDir, file);
    const newFile = resolve(config.basePath, file);
    if (existsSync(oldFile) && !existsSync(newFile)) {
      moveEntry(oldFile, newFile, file);
    }
  }
}

const DATA_FILES = [
  "sessions.json", "queue.json", "run-configs.json", "run-processes.json",
  "metrics.json", "session-names.json", "users.json", "settings.json",
  "schedules.json", "history.jsonl", "secrets.json",
];

for (const file of DATA_FILES) {
  const legacy = resolve(config.basePath, file);
  const target = resolve(config.dataPath, file);
  if (existsSync(legacy) && !existsSync(target)) {
    moveEntry(legacy, target, `${file} → data/${file}`);
  }
}
