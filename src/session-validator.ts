import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const CLAUDE_PROJECTS_ROOT = resolve(homedir(), ".claude", "projects");
const CACHE_TTL_MS = 15_000;

let cache: { ids: Set<string>; at: number } | null = null;

function scanSessionIds(): Set<string> | null {
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

function existingSessionIds(): Set<string> | null {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.ids;
  const ids = scanSessionIds();
  if (!ids) return null;
  cache = { ids, at: Date.now() };
  return ids;
}

// Retorna apenas as sessões cujo transcript do SDK ainda existe em disco.
// Se o estado do disco não puder ser lido, não filtra nada (fail-open).
export function filterExistingSessions<T extends { sessionId: string }>(refs: T[]): { valid: T[]; removed: string[] } {
  const existing = existingSessionIds();
  if (!existing) return { valid: refs, removed: [] };
  const valid: T[] = [];
  const removed: string[] = [];
  for (const ref of refs) {
    if (existing.has(ref.sessionId)) valid.push(ref);
    else removed.push(ref.sessionId);
  }
  return { valid, removed };
}

// Cache pode estar defasado para sessões recém-criadas; num miss, re-escaneia antes de condenar.
export function sessionFileExists(sessionId: string): boolean {
  const cached = existingSessionIds();
  if (!cached) return true;
  if (cached.has(sessionId)) return true;

  const fresh = scanSessionIds();
  if (!fresh) return true;
  cache = { ids: fresh, at: Date.now() };
  return fresh.has(sessionId);
}
