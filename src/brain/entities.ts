import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseWikiFrontmatterLoose } from "./frontmatter.js";
import { brainKeys, getRedis } from "./redis.js";
import { normalizeForIndex } from "./text.js";
import { perScope, type BrainScope } from "./scope.js";

const ENTITY_DIRS = ["people", "orgs", "projects", "topics"];

interface AliasState {
  cache: Map<string, string> | null;
  build: Promise<Map<string, string>> | null;
  generation: number;
}

const aliasState = perScope((): AliasState => ({ cache: null, build: null, generation: 0 }));

export function invalidateAliasCache(scope: BrainScope): void {
  const state = aliasState(scope);
  state.cache = null;
  state.generation += 1;
}

async function buildAliasTable(scope: BrainScope): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  for (const dir of ENTITY_DIRS) {
    const abs = resolve(scope.wikiDir, dir);
    if (!existsSync(abs)) continue;
    const files = (await readdir(abs).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      try {
        const { data } = parseWikiFrontmatterLoose(await readFile(resolve(abs, file), "utf-8"));
        const path = `wiki/${dir}/${file}`;
        const keys: string[] = [file.replace(/\.md$/, "")];
        if (typeof data.slug === "string") keys.push(data.slug);
        if (typeof data.title === "string") keys.push(data.title);
        if (Array.isArray(data.aliases)) {
          keys.push(...data.aliases.filter((a): a is string => typeof a === "string"));
        }
        for (const key of keys) {
          const normalized = normalizeForIndex(key);
          if (normalized && !table.has(normalized)) table.set(normalized, path);
        }
      } catch {}
    }
  }
  return table;
}

async function loadAliasTable(scope: BrainScope): Promise<Map<string, string>> {
  const state = aliasState(scope);
  if (state.cache) return state.cache;
  if (!state.build) {
    const generation = state.generation;
    state.build = buildAliasTable(scope)
      .then((table) => {
        if (generation === state.generation) state.cache = table;
        return table;
      })
      .finally(() => {
        state.build = null;
      });
  }
  return state.build;
}

export async function resolveEntities(scope: BrainScope, names: string[]): Promise<{ paths: string[]; unknown: string[] }> {
  const table = await loadAliasTable(scope);
  const paths = new Set<string>();
  const unknown: string[] = [];
  for (const name of names) {
    const normalized = normalizeForIndex(name);
    if (!normalized) continue;
    const path = table.get(normalized);
    if (path) paths.add(path);
    else unknown.push(name);
  }
  return { paths: [...paths], unknown };
}

export async function noteCandidates(scope: BrainScope, names: string[]): Promise<void> {
  if (names.length === 0) return;
  const redis = getRedis();
  try {
    for (const name of names) {
      const normalized = normalizeForIndex(name);
      if (normalized) await redis.hincrby(brainKeys(scope).aliasCandidates, normalized, 1);
    }
  } catch {}
}

export async function candidateCount(scope: BrainScope, name: string): Promise<number> {
  try {
    const value = await getRedis().hget(brainKeys(scope).aliasCandidates, normalizeForIndex(name));
    return Number(value) || 0;
  } catch {
    return 0;
  }
}
