import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { ensureCollection, getClient, isEnabled } from "../memory/qdrant.js";
import { embed } from "../memory/embeddings.js";
import { bm25Vector } from "../memory/bm25.js";
import { chunkText } from "../memory/chunk.js";
import { normalizeForIndex } from "./text.js";
import type { BrainTenant, WikiFrontmatter, WikiPageType } from "./types.js";

export interface BrainIndexPayload {
  text: string;
  targetType: "brain";
  targetName: BrainTenant;
  sourceKey: string;
  type: WikiPageType;
  title: string;
  containsPii: boolean;
  status: "active" | "dormant" | "archived";
  pinned: boolean;
  salience: number;
  confidence: "low" | "medium" | "high";
  updatedAt: string;
  ts: string;
  current: boolean;
  chunkIndex: number;
  contentHash: string;
  retrievalCount: number;
  helpfulCount: number;
}

export function brainIndexEnabled(): boolean {
  return isEnabled();
}

let indexesReady = false;

export async function ensureBrainIndex(): Promise<void> {
  const c = getClient();
  if (!c) throw new Error("QDRANT_URL/QDRANT_API_KEY ausentes");
  await ensureCollection();
  if (indexesReady) return;
  const name = config.qdrantCollection;
  const info = await c.getCollection(name);
  const schema = (info?.payload_schema ?? {}) as Record<string, unknown>;
  const wanted: [string, "keyword" | "bool"][] = [
    ["type", "keyword"],
    ["containsPii", "bool"],
  ];
  for (const [field, fieldSchema] of wanted) {
    if (!Object.prototype.hasOwnProperty.call(schema, field)) {
      try {
        await c.createPayloadIndex(name, { field_name: field, field_schema: fieldSchema, wait: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(msg)) throw err;
      }
    }
  }
  indexesReady = true;
}

export function brainSparseVector(text: string): ReturnType<typeof bm25Vector> {
  return bm25Vector(config.bm25NormalizeDiacritics ? normalizeForIndex(text) : text);
}

async function supersedeSourceKey(sourceKey: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  await c.setPayload(config.qdrantCollection, {
    payload: { current: false },
    filter: {
      must: [
        { key: "targetType", match: { value: "brain" } },
        { key: "sourceKey", match: { value: sourceKey } },
      ],
    },
    wait: true,
  });
}

export async function upsertWikiPage(
  relPath: string,
  frontmatter: WikiFrontmatter,
  body: string,
  contentHash: string,
): Promise<number> {
  const c = getClient();
  if (!c) throw new Error("Qdrant indisponível");
  const header = `# ${frontmatter.title}\ntipo: ${frontmatter.type} · tenant: ${frontmatter.tenant} · slug: ${frontmatter.slug}\n\n`;
  const chunks = chunkText(body).map((chunk) => header + chunk);
  if (chunks.length === 0) chunks.push(header.trim());

  const denseVectors = await embed(chunks, "document");
  await supersedeSourceKey(relPath);

  const ts = new Date().toISOString();
  const points = chunks.map((chunk, i) => {
    const sparse = brainSparseVector(chunk);
    const vector: Record<string, unknown> = { dense: denseVectors[i] };
    if (sparse) vector.bm25 = sparse;
    const payload: BrainIndexPayload = {
      text: chunk,
      targetType: "brain",
      targetName: frontmatter.tenant,
      sourceKey: relPath,
      type: frontmatter.type,
      title: frontmatter.title,
      containsPii: frontmatter.contains_pii === 1,
      status: frontmatter.status,
      pinned: frontmatter.pinned,
      salience: frontmatter.salience,
      confidence: frontmatter.confidence,
      updatedAt: frontmatter.updated_at,
      ts,
      current: true,
      chunkIndex: i,
      contentHash,
      retrievalCount: 0,
      helpfulCount: 0,
    };
    return { id: randomUUID(), vector, payload };
  });

  await c.upsert(config.qdrantCollection, { wait: true, points: points as never });
  return points.length;
}

export async function deleteBySourceKey(sourceKey: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  await c.delete(config.qdrantCollection, {
    wait: true,
    filter: {
      must: [
        { key: "targetType", match: { value: "brain" } },
        { key: "sourceKey", match: { value: sourceKey } },
      ],
    },
  });
}

export async function countBrainPoints(): Promise<{ total: number; current: number }> {
  const c = getClient();
  if (!c) return { total: 0, current: 0 };
  try {
    const base = { must: [{ key: "targetType", match: { value: "brain" } }] };
    const [total, current] = await Promise.all([
      c.count(config.qdrantCollection, { filter: base, exact: true }),
      c.count(config.qdrantCollection, {
        filter: { must: [...base.must, { key: "current", match: { value: true } }] },
        exact: true,
      }),
    ]);
    return { total: total.count, current: current.count };
  } catch {
    return { total: 0, current: 0 };
  }
}

export async function listCurrentSourceKeys(): Promise<Set<string>> {
  const c = getClient();
  const keys = new Set<string>();
  if (!c) return keys;
  let offset: unknown = undefined;
  do {
    const res = await c.scroll(config.qdrantCollection, {
      filter: {
        must: [
          { key: "targetType", match: { value: "brain" } },
          { key: "current", match: { value: true } },
        ],
      },
      with_payload: { include: ["sourceKey"] },
      with_vector: false,
      limit: 256,
      offset: offset as never,
    });
    for (const p of res.points ?? []) {
      const sourceKey = (p.payload as { sourceKey?: string } | undefined)?.sourceKey;
      if (sourceKey) keys.add(sourceKey);
    }
    offset = res.next_page_offset ?? undefined;
  } while (offset);
  return keys;
}

export async function pruneOldVersions(keepPerSourceKey = 5): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  const bySource = new Map<string, { id: string | number; ts: string }[]>();
  let offset: unknown = undefined;
  do {
    const res = await c.scroll(config.qdrantCollection, {
      filter: {
        must: [{ key: "targetType", match: { value: "brain" } }],
        must_not: [{ key: "current", match: { value: true } }],
      },
      with_payload: { include: ["sourceKey", "ts"] },
      with_vector: false,
      limit: 256,
      offset: offset as never,
    });
    for (const p of res.points ?? []) {
      const payload = p.payload as { sourceKey?: string; ts?: string } | undefined;
      if (!payload?.sourceKey) continue;
      const list = bySource.get(payload.sourceKey) ?? [];
      list.push({ id: p.id, ts: payload.ts ?? "" });
      bySource.set(payload.sourceKey, list);
    }
    offset = res.next_page_offset ?? undefined;
  } while (offset);

  const toDelete: (string | number)[] = [];
  for (const points of bySource.values()) {
    const generations = new Map<string, (string | number)[]>();
    for (const p of points) {
      const list = generations.get(p.ts) ?? [];
      list.push(p.id);
      generations.set(p.ts, list);
    }
    const ordered = [...generations.keys()].sort().reverse();
    for (const ts of ordered.slice(keepPerSourceKey)) {
      toDelete.push(...(generations.get(ts) ?? []));
    }
  }
  if (toDelete.length > 0) {
    await c.delete(config.qdrantCollection, { wait: true, points: toDelete as never });
  }
  return toDelete.length;
}

export async function bumpCounter(
  pointIds: (string | number)[],
  field: "retrievalCount" | "helpfulCount",
  currentValues: Map<string | number, number>,
): Promise<void> {
  const c = getClient();
  if (!c || pointIds.length === 0) return;
  for (const id of pointIds) {
    const next = (currentValues.get(id) ?? 0) + 1;
    await c
      .setPayload(config.qdrantCollection, { payload: { [field]: next }, points: [id], wait: false })
      .catch(() => {});
  }
}

export async function bumpHelpfulBySourceKey(sourceKey: string): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  let bumped = 0;
  let offset: unknown = undefined;
  do {
    const res = await c.scroll(config.qdrantCollection, {
      filter: {
        must: [
          { key: "targetType", match: { value: "brain" } },
          { key: "sourceKey", match: { value: sourceKey } },
          { key: "current", match: { value: true } },
        ],
      },
      with_payload: { include: ["helpfulCount"] },
      with_vector: false,
      limit: 64,
      offset: offset as never,
    });
    for (const p of res.points ?? []) {
      const current = ((p.payload as { helpfulCount?: number } | undefined)?.helpfulCount ?? 0) + 1;
      await c
        .setPayload(config.qdrantCollection, { payload: { helpfulCount: current }, points: [p.id], wait: false })
        .catch(() => {});
      bumped += 1;
    }
    offset = res.next_page_offset ?? undefined;
  } while (offset);
  return bumped;
}
