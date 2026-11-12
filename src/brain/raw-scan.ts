import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseRawFile } from "./frontmatter.js";
import type { BrainScope } from "./scope.js";

export interface RawScanItem {
  relPath: string;
  threadKey: string;
  subject: string;
  relevance: number | null;
  occurredTo: string;
  compiled: boolean;
}

export async function scanRawThreads(scope: BrainScope): Promise<RawScanItem[]> {
  const items: RawScanItem[] = [];
  if (!existsSync(scope.rawDir)) return items;
  const channels = await readdir(scope.rawDir).catch(() => [] as string[]);
  for (const channel of channels.filter((c) => !c.startsWith("."))) {
    const channelDir = resolve(scope.rawDir, channel);
    const years = await readdir(channelDir).catch(() => [] as string[]);
    for (const year of years.filter((y) => /^\d{4}$/.test(y))) {
      const months = await readdir(resolve(channelDir, year)).catch(() => [] as string[]);
      for (const month of months.filter((m) => /^\d{2}$/.test(m))) {
        const dir = resolve(channelDir, year, month);
        const files = await readdir(dir).catch(() => [] as string[]);
        for (const file of files.filter((f) => f.endsWith(".md"))) {
          try {
            const parsed = parseRawFile(await readFile(resolve(dir, file), "utf-8"));
            if (!parsed) continue;
            items.push({
              relPath: `raw/${channel}/${year}/${month}/${file}`,
              threadKey: parsed.frontmatter.thread_key,
              subject: parsed.frontmatter.subject,
              relevance: parsed.frontmatter.triage?.relevance ?? null,
              occurredTo: parsed.frontmatter.occurred_to,
              compiled: (parsed.frontmatter.compiled_into?.length ?? 0) > 0,
            });
          } catch {}
        }
      }
    }
  }
  return items;
}
