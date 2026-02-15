import { appendFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
}

const MAX_LINES = 500;
const TRIM_TO = 300;
const TRIM_DEBOUNCE_MS = 5000;

let lineCount = -1;
let trimTimer: ReturnType<typeof setTimeout> | null = null;

function historyPath(): string {
  return resolve(config.basePath, "history.jsonl");
}

async function trimIfNeeded(): Promise<void> {
  const filePath = historyPath();
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trimEnd().split("\n");
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(-TRIM_TO);
      await writeFile(filePath, trimmed.join("\n") + "\n", "utf-8");
      lineCount = TRIM_TO;
    } else {
      lineCount = lines.length;
    }
  } catch {
    // non-critical
  }
}

export function appendHistory(entry: HistoryEntry): void {
  const filePath = historyPath();
  appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8").then(() => {
    lineCount++;
    if (lineCount > MAX_LINES && !trimTimer) {
      trimTimer = setTimeout(() => {
        trimTimer = null;
        trimIfNeeded();
      }, TRIM_DEBOUNCE_MS);
    }
  }).catch(() => {
    // non-critical
  });
}

export async function loadHistory(limit = 20): Promise<HistoryEntry[]> {
  const filePath = historyPath();
  if (!existsSync(filePath)) return [];

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trimEnd().split("\n").filter(Boolean);
    lineCount = lines.length;
    const entries: HistoryEntry[] = [];

    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}
