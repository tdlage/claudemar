import { appendFile, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

export interface HistoryEntry {
  id: string;
  prompt: string;
  targetType: string;
  targetName: string;
  agentName?: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  costUsd: number;
  durationMs: number;
  source: string;
  output?: string;
  error?: string | null;
  sessionId?: string;
  planMode?: boolean;
  username?: string;
}

const MAX_LINES = 500;
const TRIM_TO = 300;
const TRIM_DEBOUNCE_MS = 5000;

const lineCounts = new Map<string, number>();
const trimTimers = new Map<string, ReturnType<typeof setTimeout>>();

function historyDir(): string {
  return resolve(config.dataPath, "history");
}

function targetFilePath(targetType: string, targetName: string): string {
  const safe = `${targetType}-${targetName}`.replace(/[^a-zA-Z0-9._-]/g, "_");
  return resolve(historyDir(), `${safe}.jsonl`);
}

function ensureHistoryDir(): void {
  const dir = historyDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function trimIfNeeded(filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trimEnd().split("\n");
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(-TRIM_TO);
      await writeFile(filePath, trimmed.join("\n") + "\n", "utf-8");
      lineCounts.set(filePath, TRIM_TO);
    } else {
      lineCounts.set(filePath, lines.length);
    }
  } catch { }
}

export function appendHistory(entry: HistoryEntry): void {
  ensureHistoryDir();
  const filePath = targetFilePath(entry.targetType, entry.targetName);
  appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8").then(() => {
    const count = (lineCounts.get(filePath) ?? 0) + 1;
    lineCounts.set(filePath, count);
    if (count > MAX_LINES && !trimTimers.has(filePath)) {
      trimTimers.set(filePath, setTimeout(() => {
        trimTimers.delete(filePath);
        trimIfNeeded(filePath);
      }, TRIM_DEBOUNCE_MS));
    }
  }).catch(() => { });
}

async function loadFile(filePath: string, limit: number): Promise<HistoryEntry[]> {
  if (!existsSync(filePath)) return [];
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trimEnd().split("\n").filter(Boolean);
    lineCounts.set(filePath, lines.length);
    const entries: HistoryEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line));
      } catch { }
    }
    return entries;
  } catch {
    return [];
  }
}

export async function loadHistory(limit = 20, targetType?: string, targetName?: string): Promise<HistoryEntry[]> {
  await migrateOldHistory();

  if (targetType && targetName) {
    return loadFile(targetFilePath(targetType, targetName), limit);
  }

  const dir = historyDir();
  if (!existsSync(dir)) return [];

  try {
    const files = await readdir(dir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const allEntries: HistoryEntry[] = [];

    for (const file of jsonlFiles) {
      const entries = await loadFile(resolve(dir, file), limit);
      allEntries.push(...entries);
    }

    allEntries.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return ta - tb;
    });

    return allEntries.slice(-limit);
  } catch {
    return [];
  }
}

const OLD_HISTORY_PATH = resolve(config.dataPath, "history.jsonl");
let migrated = false;

async function migrateOldHistory(): Promise<void> {
  if (migrated) return;
  migrated = true;

  if (!existsSync(OLD_HISTORY_PATH)) return;

  try {
    const content = await readFile(OLD_HISTORY_PATH, "utf-8");
    const lines = content.trimEnd().split("\n").filter(Boolean);
    if (lines.length === 0) return;

    ensureHistoryDir();
    const buckets = new Map<string, string[]>();

    for (const line of lines) {
      try {
        const entry: HistoryEntry = JSON.parse(line);
        const filePath = targetFilePath(entry.targetType, entry.targetName);
        const bucket = buckets.get(filePath) ?? [];
        bucket.push(line);
        buckets.set(filePath, bucket);
      } catch { }
    }

    for (const [filePath, entryLines] of buckets) {
      await appendFile(filePath, entryLines.join("\n") + "\n", "utf-8");
    }

    await rename(OLD_HISTORY_PATH, OLD_HISTORY_PATH + ".bak");
    console.log(`[history] Migrated ${lines.length} entries from history.jsonl to per-target files`);
  } catch (err) {
    console.error("[history] Migration failed:", err);
  }
}
