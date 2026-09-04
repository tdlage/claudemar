import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { settingsManager } from "./settings-manager.js";
import type { AgentRuntime } from "./providers/llm.js";
import { getCodexHome } from "./codex/auth.js";

const CLAUDE_PROJECTS_ROOT = resolve(homedir(), ".claude", "projects");
const CACHE_TTL_MS = 15_000;
const CODEX_SESSION_DIRS = ["sessions", "archived_sessions"];
const CODEX_ROLLOUT_PATTERN = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})/;

const caches: Record<AgentRuntime, { ids: Set<string>; at: number } | null> = { claude: null, codex: null };

function scanClaudeSessionIds(): Set<string> | null {
  if (!existsSync(CLAUDE_PROJECTS_ROOT)) return null;
  try {
    const ids = new Set<string>();
    for (const entry of readdirSync(CLAUDE_PROJECTS_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        for (const file of readdirSync(resolve(CLAUDE_PROJECTS_ROOT, entry.name))) {
          if (file.endsWith(".jsonl")) ids.add(file.slice(0, -".jsonl".length));
        }
      } catch { /* diretório inacessível */ }
    }
    return ids;
  } catch {
    return null;
  }
}

export function codexThreadIdFromFileName(fileName: string): string | null {
  const match = fileName.match(CODEX_ROLLOUT_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

function collectRollouts(dir: string, ids: Set<string>, depth: number): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (depth > 0) collectRollouts(resolve(dir, entry.name), ids, depth - 1);
      continue;
    }
    const id = codexThreadIdFromFileName(entry.name);
    if (id) ids.add(id);
  }
}

// Rollouts do Codex ficam em <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl.
function scanCodexSessionIds(): Set<string> | null {
  const home = getCodexHome();
  if (!existsSync(home)) return null;
  const ids = new Set<string>();
  for (const sub of CODEX_SESSION_DIRS) {
    const root = resolve(home, sub);
    if (existsSync(root)) collectRollouts(root, ids, 3);
  }
  return ids;
}

function scanSessionIds(runtime: AgentRuntime): Set<string> | null {
  return runtime === "codex" ? scanCodexSessionIds() : scanClaudeSessionIds();
}

function activeRuntime(): AgentRuntime {
  return settingsManager.getActiveProfile().runtime;
}

function existingSessionIds(runtime: AgentRuntime): Set<string> | null {
  const cached = caches[runtime];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ids;
  const ids = scanSessionIds(runtime);
  if (!ids) return null;
  caches[runtime] = { ids, at: Date.now() };
  return ids;
}

function normalizeId(runtime: AgentRuntime, sessionId: string): string {
  return runtime === "codex" ? sessionId.toLowerCase() : sessionId;
}

// Valida cada sessão no runtime em que ela foi criada. Se o estado do disco daquele
// runtime não puder ser lido, mantém a referência (fail-open).
export function filterExistingSessions<T extends { sessionId: string; runtime?: AgentRuntime }>(refs: T[]): { valid: T[]; removed: string[] } {
  const valid: T[] = [];
  const removed: string[] = [];
  for (const ref of refs) {
    const runtime = ref.runtime ?? activeRuntime();
    const existing = existingSessionIds(runtime);
    if (!existing) {
      valid.push(ref);
      continue;
    }
    if (existing.has(normalizeId(runtime, ref.sessionId))) valid.push(ref);
    else removed.push(ref.sessionId);
  }
  return { valid, removed };
}

// Cache pode estar defasado para sessões recém-criadas; num miss, re-escaneia antes de condenar.
export function sessionFileExists(sessionId: string): boolean {
  const runtime = activeRuntime();
  const id = normalizeId(runtime, sessionId);
  const cached = existingSessionIds(runtime);
  if (!cached) return true;
  if (cached.has(id)) return true;

  const fresh = scanSessionIds(runtime);
  if (!fresh) return true;
  caches[runtime] = { ids: fresh, at: Date.now() };
  return fresh.has(id);
}
