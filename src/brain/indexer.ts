import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { brainKeys, getRedis, incrMetric } from "./redis.js";
import { parseWikiFile } from "./frontmatter.js";
import { perScope, type BrainScope } from "./scope.js";
import { WIKI_DIRS } from "./wiki.js";
import { sha256Hex } from "./text.js";
import { brainSchedulers } from "./schedulers.js";
import { emitActivity } from "./events.js";
import {
  brainIndexEnabled,
  deleteBySourceKey,
  ensureBrainIndex,
  listCurrentSourceKeys,
  pruneOldVersions,
  upsertWikiPage,
} from "./brain-index.js";

const FULL_WINDOW_HOURS: [number, number] = [3, 5];
/**
 * Fingerprint do que está gravado em cada ponto do índice. Mudou aqui (novo campo de payload,
 * outra tokenização, outro chunking) → o conteúdo dos arquivos não muda, então o diff por hash
 * não detectaria nada e as buscas passariam a filtrar por um campo que os pontos antigos não têm.
 */
const INDEX_SCHEMA_VERSION = `2|tenant|bm25:${config.bm25NormalizeDiacritics ? "norm" : "raw"}`;
const FULL_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

const reindexState = perScope((): { inFlight: boolean } => ({ inFlight: false }));

async function listWikiFiles(scope: BrainScope): Promise<string[]> {
  const files: string[] = [];
  for (const dir of WIKI_DIRS) {
    const abs = resolve(scope.wikiDir, dir);
    if (!existsSync(abs)) continue;
    const entries = await readdir(abs).catch(() => [] as string[]);
    for (const entry of entries.filter((f) => f.endsWith(".md"))) {
      files.push(`wiki/${dir}/${entry}`);
    }
  }
  return files.sort();
}

export interface FileDiff {
  changed: string[];
  removed: string[];
}

export function diffFiles(current: Map<string, string>, tracked: Record<string, string>): FileDiff {
  const changed: string[] = [];
  for (const [relPath, hash] of current) {
    if (tracked[relPath] !== hash) changed.push(relPath);
  }
  const removed = Object.keys(tracked).filter((relPath) => !current.has(relPath));
  return { changed, removed };
}

async function ensureIndexSchema(scope: BrainScope): Promise<void> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const stored = await redis.get(keys.indexSchema).catch(() => null);
  if (stored === INDEX_SCHEMA_VERSION) return;
  await redis.del(keys.indexFiles).catch(() => {});
  await redis.set(keys.indexSchema, INDEX_SCHEMA_VERSION).catch(() => {});
  if (stored) {
    emitActivity(scope, {
      kind: "index",
      label: "esquema do índice mudou — reindexando o wiki inteiro",
    });
  }
}

export async function incrementalTick(scope: BrainScope): Promise<{ indexed: number; removed: number }> {
  await ensureBrainIndex();
  await ensureIndexSchema(scope);
  const redis = getRedis();
  const keys = brainKeys(scope);

  const files = await listWikiFiles(scope);
  const tracked = (await redis.hgetall(keys.indexFiles).catch(() => ({}))) as Record<string, string>;

  const current = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const relPath of files) {
    try {
      const abs = resolve(scope.root, relPath);
      const info = await stat(abs);
      const stamp = `${Math.round(info.mtimeMs)}:${info.size}`;
      const previous = tracked[relPath];
      if (previous && previous.endsWith(`|${stamp}`)) {
        current.set(relPath, previous);
        continue;
      }
      const content = await readFile(abs, "utf-8");
      current.set(relPath, `${sha256Hex(content)}|${stamp}`);
      contents.set(relPath, content);
    } catch {}
  }

  const { changed, removed } = diffFiles(current, tracked);

  let indexed = 0;
  for (const relPath of changed) {
    const content = contents.get(relPath) ?? (await readFile(resolve(scope.root, relPath), "utf-8").catch(() => null));
    if (!content) continue;
    const parsed = parseWikiFile(content);
    if (!parsed) {
      console.warn(`[brain:index] frontmatter inválido, pulando: ${relPath}`);
      continue;
    }
    const stamped = current.get(relPath)!;
    await upsertWikiPage(scope, relPath, parsed.frontmatter, parsed.body, stamped.split("|")[0]);
    await redis.hset(keys.indexFiles, relPath, stamped);
    indexed += 1;
  }

  if (removed.length > 0) {
    for (const relPath of removed) await deleteBySourceKey(scope, relPath);
    await redis.hdel(keys.indexFiles, ...removed).catch(() => {});
  }

  if (indexed > 0 || removed.length > 0) {
    await incrMetric(scope, "index:pages", indexed);
    emitActivity(scope, {
      kind: "index",
      label: `índice T3: ${indexed} página(s) indexada(s)${removed.length > 0 ? `, ${removed.length} removida(s)` : ""}`,
    });
  }
  return { indexed, removed: removed.length };
}

async function nightlyFullIfDue(scope: BrainScope): Promise<void> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: config.brainTz, hour: "2-digit", hour12: false }).format(new Date()),
  );
  if (hour < FULL_WINDOW_HOURS[0] || hour >= FULL_WINDOW_HOURS[1]) return;
  const lastFull = await redis.get(keys.indexLastFull).catch(() => null);
  if (lastFull && Date.now() - new Date(lastFull).getTime() < FULL_MIN_INTERVAL_MS) return;

  const files = new Set(await listWikiFiles(scope));
  const inQdrant = await listCurrentSourceKeys(scope);
  let orphans = 0;
  for (const sourceKey of inQdrant) {
    if (!files.has(sourceKey)) {
      await deleteBySourceKey(scope, sourceKey);
      await redis.hdel(keys.indexFiles, sourceKey);
      orphans += 1;
    }
  }
  const pruned = await pruneOldVersions(scope).catch(() => 0);

  await redis.set(keys.indexLastFull, new Date().toISOString()).catch(() => {});
  if (orphans > 0 || pruned > 0) {
    emitActivity(scope, {
      kind: "index",
      label: `reconcile noturno: ${orphans} órfão(s), ${pruned} versão(ões) antiga(s) podada(s)`,
    });
  }

}

export async function forceReindex(scope: BrainScope, full: boolean): Promise<{ indexed: number; removed: number }> {
  const state = reindexState(scope);
  if (state.inFlight) throw new Error("reindex já em execução");
  state.inFlight = true;
  try {
    if (full) {
      const files = new Set(await listWikiFiles(scope));
      for (const sourceKey of await listCurrentSourceKeys(scope)) {
        if (!files.has(sourceKey)) await deleteBySourceKey(scope, sourceKey);
      }
      await getRedis().del(brainKeys(scope).indexFiles).catch(() => {});
    }
    return await incrementalTick(scope);
  } finally {
    state.inFlight = false;
  }
}

export function reindexRunning(scope: BrainScope): boolean {
  return reindexState(scope).inFlight;
}

export async function indexStatus(scope: BrainScope): Promise<{
  enabled: boolean;
  trackedFiles: number;
  lastFull: string | null;
  reindexRunning: boolean;
}> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const [trackedFiles, lastFull] = await Promise.all([
    redis.hlen(keys.indexFiles).catch(() => 0),
    redis.get(keys.indexLastFull).catch(() => null),
  ]);
  return { enabled: brainIndexEnabled(), trackedFiles, lastFull, reindexRunning: reindexRunning(scope) };
}

brainSchedulers.register({
  name: "index",
  cadenceMs: (s) => s.cadences.indexMs,
  disabledReason: () => (brainIndexEnabled() ? null : "QDRANT_URL/QDRANT_API_KEY ausentes"),
  run: async (scope) => {
    const state = reindexState(scope);
    if (state.inFlight) return "reindex manual em execução";
    state.inFlight = true;
    try {
      const result = await incrementalTick(scope);
      await nightlyFullIfDue(scope);
      return `${result.indexed} indexadas, ${result.removed} removidas`;
    } finally {
      state.inFlight = false;
    }
  },
});
