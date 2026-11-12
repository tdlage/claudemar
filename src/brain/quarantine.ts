import { readFile, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { brainWriteLock, writeFileAtomic } from "./git.js";
import { brainKeys, getRedis, incrMetric } from "./redis.js";
import type { BrainScope } from "./scope.js";
import { hash8 } from "./text.js";
import type { QuarantineItem, QuarantineKind } from "./types.js";

const ID_RE = /^[0-9A-Za-z_-]+$/;

export async function quarantineWrite(
  scope: BrainScope,
  kind: QuarantineKind,
  error: string,
  payload: unknown,
  threadKey: string | null = null,
): Promise<string> {
  const ts = new Date().toISOString();
  const id = `${ts.replace(/[:.]/g, "-")}-${kind}-${hash8(`${ts}${error}${threadKey ?? ""}`)}`;
  const item: QuarantineItem = { id, kind, ts, threadKey, error, payload };
  await writeFileAtomic(scope, resolve(scope.quarantineDir, `${id}.json`), JSON.stringify(item, null, 2));
  await incrMetric(scope, "quarantined");
  return id;
}

export async function quarantineList(scope: BrainScope): Promise<QuarantineItem[]> {
  try {
    const files = (await readdir(scope.quarantineDir)).filter((f) => f.endsWith(".json"));
    files.sort((a, b) => b.localeCompare(a, "en"));
    const items: QuarantineItem[] = [];
    for (const file of files.slice(0, 200)) {
      try {
        const raw = JSON.parse(await readFile(resolve(scope.quarantineDir, file), "utf-8")) as QuarantineItem;
        items.push({ ...raw, payload: undefined });
      } catch {}
    }
    return items;
  } catch {
    return [];
  }
}

export async function quarantineCount(scope: BrainScope): Promise<number> {
  try {
    return (await readdir(scope.quarantineDir)).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function quarantineRead(scope: BrainScope, id: string): Promise<QuarantineItem | null> {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(resolve(scope.quarantineDir, `${id}.json`), "utf-8")) as QuarantineItem;
  } catch {
    return null;
  }
}

export async function quarantineDiscard(scope: BrainScope, id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  return brainWriteLock(scope, async () => {
    try {
      await rename(resolve(scope.quarantineDir, `${id}.json`), resolve(scope.quarantineDiscardedDir, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  });
}

export async function quarantineRetry(scope: BrainScope, id: string): Promise<"triage" | "compile" | null> {
  const item = await quarantineRead(scope, id);
  if (!item || !item.threadKey) return null;
  const keys = brainKeys(scope);
  const compile = item.kind === "compile_failed" || item.kind === "invalid_operations";
  await getRedis().zadd(compile ? keys.compilePending : keys.triagePending, Date.now(), item.threadKey);
  await getRedis().hdel(compile ? keys.compileAttempts : keys.triageAttempts, item.threadKey).catch(() => {});
  await quarantineDiscard(scope, id);
  return compile ? "compile" : "triage";
}
