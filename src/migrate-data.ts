import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

  migrateClaudeSessions(config.installDir, config.basePath);
}

function migrateClaudeSessions(oldBase: string, newBase: string): void {
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjectsDir)) return;

  const oldPrefix = oldBase.replace(/[/.]/g, "-");
  const newPrefix = newBase.replace(/[/.]/g, "-");

  const entries = readdirSync(claudeProjectsDir);
  const toMigrate = entries.filter((e) => e.startsWith(oldPrefix + "-"));
  if (toMigrate.length === 0) return;

  const oldPathPatterns = [
    { from: `${oldBase}/projects/`, to: `${newBase}/projects/` },
    { from: `${oldBase}/agents/`, to: `${newBase}/agents/` },
    { from: `${oldBase}/orchestrator`, to: `${newBase}/orchestrator` },
  ];

  for (const entry of toMigrate) {
    const newEntry = entry.replace(oldPrefix, newPrefix);
    const oldPath = join(claudeProjectsDir, entry);
    const newPath = join(claudeProjectsDir, newEntry);

    if (existsSync(newPath)) continue;

    renameSync(oldPath, newPath);

    const files = readdirSync(newPath, { recursive: true, withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      const filePath = join(file.parentPath ?? file.path, file.name);
      try {
        let content = readFileSync(filePath, "utf-8");
        let changed = false;
        for (const p of oldPathPatterns) {
          if (content.includes(p.from)) {
            content = content.replaceAll(p.from, p.to);
            changed = true;
          }
        }
        if (changed) writeFileSync(filePath, content);
      } catch {
        // skip binary or unreadable files
      }
    }
  }

  console.log(`[migration] Migrated ${toMigrate.length} Claude session dirs`);
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
