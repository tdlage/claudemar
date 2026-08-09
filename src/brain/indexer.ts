import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { getRedis, incrMetric, KEYS } from "./redis.js";
import { brainRoot, wikiDir } from "./paths.js";
import { parseWikiFile } from "./frontmatter.js";
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

let reindexInFlight = false;

async function listWikiFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of WIKI_DIRS) {
    const abs = resolve(wikiDir, dir);
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

async function ensureIndexSchema(): Promise<void> {
  const redis = getRedis();
  const stored = await redis.get(KEYS.indexSchema).catch(() => null);
  if (stored === INDEX_SCHEMA_VERSION) return;
  await redis.del(KEYS.indexFiles).catch(() => {});
  await redis.set(KEYS.indexSchema, INDEX_SCHEMA_VERSION).catch(() => {});
  if (stored) {
    emitActivity({
      kind: "index",
      label: "esquema do índice mudou — reindexando o wiki inteiro",
    });
  }
}

export async function incrementalTick(): Promise<{ indexed: number; removed: number }> {
  await ensureBrainIndex();
  await ensureIndexSchema();
  const redis = getRedis();

  const files = await listWikiFiles();
  const tracked = (await redis.hgetall(KEYS.indexFiles).catch(() => ({}))) as Record<string, string>;

  const current = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const relPath of files) {
    try {
      const abs = resolve(brainRoot, relPath);
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
    const content = contents.get(relPath) ?? (await readFile(resolve(brainRoot, relPath), "utf-8").catch(() => null));
    if (!content) continue;
    const parsed = parseWikiFile(content);
    if (!parsed) {
      console.warn(`[brain:index] frontmatter inválido, pulando: ${relPath}`);
      continue;
    }
    const stamped = current.get(relPath)!;
    await upsertWikiPage(relPath, parsed.frontmatter, parsed.body, stamped.split("|")[0]);
    await redis.hset(KEYS.indexFiles, relPath, stamped);
    indexed += 1;
  }

  if (removed.length > 0) {
    for (const relPath of removed) await deleteBySourceKey(relPath);
    await redis.hdel(KEYS.indexFiles, ...removed).catch(() => {});
  }

  if (indexed > 0 || removed.length > 0) {
    await incrMetric("index:pages", indexed);
    emitActivity({
      kind: "index",
      label: `índice T3: ${indexed} página(s) indexada(s)${removed.length > 0 ? `, ${removed.length} removida(s)` : ""}`,
    });
  }
  return { indexed, removed: removed.length };
}

async function nightlyFullIfDue(): Promise<void> {
  const redis = getRedis();
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: config.brainTz, hour: "2-digit", hour12: false }).format(new Date()),
  );
  if (hour < FULL_WINDOW_HOURS[0] || hour >= FULL_WINDOW_HOURS[1]) return;
  const lastFull = await redis.get(KEYS.indexLastFull).catch(() => null);
  if (lastFull && Date.now() - new Date(lastFull).getTime() < FULL_MIN_INTERVAL_MS) return;

  const files = new Set(await listWikiFiles());
  const inQdrant = await listCurrentSourceKeys();
  let orphans = 0;
  for (const sourceKey of inQdrant) {
    if (!files.has(sourceKey)) {
      await deleteBySourceKey(sourceKey);
      await redis.hdel(KEYS.indexFiles, sourceKey);
      orphans += 1;
    }
  }
  const pruned = await pruneOldVersions().catch(() => 0);

  await redis.set(KEYS.indexLastFull, new Date().toISOString()).catch(() => {});
  if (orphans > 0 || pruned > 0) {
    emitActivity({
      kind: "index",
      label: `reconcile noturno: ${orphans} órfão(s), ${pruned} versão(ões) antiga(s) podada(s)`,
    });
  }

}

export async function forceReindex(full: boolean): Promise<{ indexed: number; removed: number }> {
  if (reindexInFlight) throw new Error("reindex já em execução");
  reindexInFlight = true;
  try {
    if (full) {
      const files = new Set(await listWikiFiles());
      for (const sourceKey of await listCurrentSourceKeys()) {
        if (!files.has(sourceKey)) await deleteBySourceKey(sourceKey);
      }
      await getRedis().del(KEYS.indexFiles).catch(() => {});
    }
    return await incrementalTick();
  } finally {
    reindexInFlight = false;
  }
}

export function reindexRunning(): boolean {
  return reindexInFlight;
}

export async function indexStatus(): Promise<{
  enabled: boolean;
  trackedFiles: number;
  lastFull: string | null;
  reindexRunning: boolean;
}> {
  const redis = getRedis();
  const [trackedFiles, lastFull] = await Promise.all([
    redis.hlen(KEYS.indexFiles).catch(() => 0),
    redis.get(KEYS.indexLastFull).catch(() => null),
  ]);
  return { enabled: brainIndexEnabled(), trackedFiles, lastFull, reindexRunning: reindexInFlight };
}

brainSchedulers.register({
  name: "index",
  cadenceMs: (s) => s.cadences.indexMs,
  disabledReason: () => (brainIndexEnabled() ? null : "QDRANT_URL/QDRANT_API_KEY ausentes"),
  run: async () => {
    if (reindexInFlight) return "reindex manual em execução";
    reindexInFlight = true;
    try {
      const result = await incrementalTick();
      await nightlyFullIfDue();
      return `${result.indexed} indexadas, ${result.removed} removidas`;
    } finally {
      reindexInFlight = false;
    }
  },
});
