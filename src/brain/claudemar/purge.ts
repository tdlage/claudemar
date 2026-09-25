import { existsSync } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { brainRoot, rawDir, wikiDir } from "../paths.js";
import { brainWriteLock } from "../git.js";
import { parseRawFile, parseWikiFrontmatterLoose } from "../frontmatter.js";
import { getRedis, KEYS } from "../redis.js";
import { emitActivity } from "../events.js";
import { WIKI_DIRS, scheduleIndexRegeneration } from "../wiki.js";
import { targetFromParticipants, targetKey, targetLabel, targetPagePath, type ClaudemarTarget } from "./targets.js";

async function listFiles(dir: string, depth: number): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory() && depth > 0) files.push(...(await listFiles(path, depth - 1)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

/** Tira do brain tudo o que veio só de um alvo excluído ou apagado: threads brutas, página do alvo e páginas derivadas. */
export async function purgeTarget(target: ClaudemarTarget): Promise<{ rawThreads: number; wikiPages: number }> {
  const key = targetKey(target);
  const rawPaths = new Set<string>();
  const threadKeys: string[] = [];
  for (const abs of await listFiles(resolve(rawDir, "claudemar"), 2)) {
    const parsed = parseRawFile(await readFile(abs, "utf-8").catch(() => ""));
    if (!parsed) continue;
    const owner = targetFromParticipants(parsed.frontmatter.participants);
    if (!owner || targetKey(owner) !== key) continue;
    rawPaths.add(relative(brainRoot, abs).split(sep).join("/"));
    threadKeys.push(parsed.frontmatter.thread_key);
  }

  const pages = new Set<string>([targetPagePath(target)]);
  for (const dir of WIKI_DIRS) {
    for (const abs of await listFiles(resolve(wikiDir, dir), 0)) {
      const { data } = parseWikiFrontmatterLoose(await readFile(abs, "utf-8").catch(() => ""));
      const sources = Array.isArray(data.sources) ? data.sources.filter((v): v is string => typeof v === "string") : [];
      if (sources.length > 0 && sources.every((source) => rawPaths.has(source))) pages.add(`wiki/${dir}/${abs.split("/").pop()}`);
    }
  }

  let wikiPages = 0;
  await brainWriteLock(async () => {
    for (const relPath of [...rawPaths, ...pages]) {
      const abs = resolve(brainRoot, relPath);
      if (!existsSync(abs)) continue;
      await unlink(abs);
      if (relPath.startsWith("wiki/")) wikiPages += 1;
    }
  });

  const redis = getRedis();
  if (threadKeys.length > 0) {
    await redis.hdel(KEYS.threadFile, ...threadKeys);
    for (const queue of [KEYS.triagePending, KEYS.triageInflight, KEYS.compilePending, KEYS.compileInflight]) {
      await redis.zrem(queue, ...threadKeys);
    }
  }
  await redis.hdel(KEYS.cmTargetHashes, key);
  await redis.zrem(KEYS.cmDirtyTargets, key);
  if (wikiPages > 0) scheduleIndexRegeneration();
  emitActivity({
    kind: "connector",
    label: `claudemar: ${targetLabel(target)} removido do brain (${rawPaths.size} thread(s), ${wikiPages} página(s))`,
  });
  return { rawThreads: rawPaths.size, wikiPages };
}
