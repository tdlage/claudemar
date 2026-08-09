import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { wikiDir } from "./paths.js";
import { parseWikiFrontmatterLoose } from "./frontmatter.js";
import { getRedis, KEYS } from "./redis.js";
import { normalizeForIndex } from "./text.js";

const ENTITY_DIRS = ["people", "orgs", "projects", "topics"];

let aliasCache: Map<string, string> | null = null;
let aliasBuild: Promise<Map<string, string>> | null = null;
let aliasGeneration = 0;

export function invalidateAliasCache(): void {
  aliasCache = null;
  aliasGeneration += 1;
}

async function buildAliasTable(): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  for (const dir of ENTITY_DIRS) {
    const abs = resolve(wikiDir, dir);
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

async function loadAliasTable(): Promise<Map<string, string>> {
  if (aliasCache) return aliasCache;
  if (!aliasBuild) {
    const generation = aliasGeneration;
    aliasBuild = buildAliasTable()
      .then((table) => {
        if (generation === aliasGeneration) aliasCache = table;
        return table;
      })
      .finally(() => {
        aliasBuild = null;
      });
  }
  return aliasBuild;
}

export async function resolveEntities(names: string[]): Promise<{ paths: string[]; unknown: string[] }> {
  const table = await loadAliasTable();
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

export async function noteCandidates(names: string[]): Promise<void> {
  if (names.length === 0) return;
  const redis = getRedis();
  try {
    for (const name of names) {
      const normalized = normalizeForIndex(name);
      if (normalized) await redis.hincrby(KEYS.aliasCandidates, normalized, 1);
    }
  } catch {}
}

export async function candidateCount(name: string): Promise<number> {
  try {
    const value = await getRedis().hget(KEYS.aliasCandidates, normalizeForIndex(name));
    return Number(value) || 0;
  } catch {
    return 0;
  }
}
