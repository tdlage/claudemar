import { readFile, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { quarantineDir, quarantineDiscardedDir } from "./paths.js";
import { brainWriteLock, writeFileAtomic } from "./git.js";
import { getRedis, KEYS, incrMetric } from "./redis.js";
import { hash8 } from "./text.js";
import type { QuarantineItem, QuarantineKind } from "./types.js";

const ID_RE = /^[0-9A-Za-z_-]+$/;

export async function quarantineWrite(
  kind: QuarantineKind,
  error: string,
  payload: unknown,
  threadKey: string | null = null,
): Promise<string> {
  const ts = new Date().toISOString();
  const id = `${ts.replace(/[:.]/g, "-")}-${kind}-${hash8(`${ts}${error}${threadKey ?? ""}`)}`;
  const item: QuarantineItem = { id, kind, ts, threadKey, error, payload };
  await writeFileAtomic(resolve(quarantineDir, `${id}.json`), JSON.stringify(item, null, 2));
  await incrMetric("quarantined");
  return id;
}

export async function quarantineList(): Promise<QuarantineItem[]> {
  try {
    const files = (await readdir(quarantineDir)).filter((f) => f.endsWith(".json"));
    files.sort((a, b) => b.localeCompare(a, "en"));
    const items: QuarantineItem[] = [];
    for (const file of files.slice(0, 200)) {
      try {
        const raw = JSON.parse(await readFile(resolve(quarantineDir, file), "utf-8")) as QuarantineItem;
        items.push({ ...raw, payload: undefined });
      } catch {}
    }
    return items;
  } catch {
    return [];
  }
}

export async function quarantineCount(): Promise<number> {
  try {
    return (await readdir(quarantineDir)).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function quarantineRead(id: string): Promise<QuarantineItem | null> {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(resolve(quarantineDir, `${id}.json`), "utf-8")) as QuarantineItem;
  } catch {
    return null;
  }
}

export async function quarantineDiscard(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  return brainWriteLock(async () => {
    try {
      await rename(resolve(quarantineDir, `${id}.json`), resolve(quarantineDiscardedDir, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  });
}

export async function quarantineRetry(id: string): Promise<"triage" | "compile" | null> {
  const item = await quarantineRead(id);
  if (!item || !item.threadKey) return null;
  const queue =
    item.kind === "compile_failed" || item.kind === "invalid_operations"
      ? KEYS.compilePending
      : KEYS.triagePending;
  await getRedis().zadd(queue, Date.now(), item.threadKey);
  const attemptsKey = queue === KEYS.compilePending ? KEYS.compileAttempts : KEYS.triageAttempts;
  await getRedis().hdel(attemptsKey, item.threadKey).catch(() => {});
  await quarantineDiscard(id);
  return queue === KEYS.compilePending ? "compile" : "triage";
}
