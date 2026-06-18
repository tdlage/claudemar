import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { isEnabled, getClient, ensureCollection } from "./qdrant.js";
import { embed } from "./embeddings.js";
import { rerank } from "./rerank.js";
import { bm25Vector } from "./bm25.js";

export interface MemoryTarget {
  targetType: string;
  targetName: string;
}

interface MemoryPayload {
  text: string;
  targetType: string;
  targetName: string;
  sourceKey: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  ts: string;
  current: boolean;
  chunkIndex: number;
  model?: string;
}

const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 400;
const CLUSTER_THRESHOLD = 0.92;

export function memoryEnabled(): boolean {
  return isEnabled();
}

export async function ensureMemoryReady(): Promise<void> {
  if (!memoryEnabled()) return;
  await ensureCollection();
}

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= CHUNK_CHARS) return trimmed ? [trimmed] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_CHARS, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function targetFilter(target: MemoryTarget) {
  return {
    must: [
      { key: "targetType", match: { value: target.targetType } },
      { key: "targetName", match: { value: target.targetName } },
    ],
  };
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toISOString().slice(0, 10);
}

async function findClusterSourceKey(target: MemoryTarget, denseVec: number[]): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.query(config.qdrantCollection, {
      query: denseVec,
      using: "dense",
      limit: 1,
      filter: { must: [...targetFilter(target).must, { key: "current", match: { value: true } }] },
      with_payload: true,
      with_vector: false,
    });
    const top = res.points?.[0];
    if (top && typeof top.score === "number" && top.score >= CLUSTER_THRESHOLD) {
      const payload = top.payload as unknown as MemoryPayload;
      return payload?.sourceKey ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function supersedeOldVersions(target: MemoryTarget, sourceKey: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  await c.setPayload(config.qdrantCollection, {
    payload: { current: false },
    filter: {
      must: [
        { key: "sourceKey", match: { value: sourceKey } },
        { key: "targetName", match: { value: target.targetName } },
        { key: "targetType", match: { value: target.targetType } },
      ],
    },
    wait: true,
  });
}

async function ingestTurnAsync(
  target: MemoryTarget,
  sessionId: string,
  role: "user" | "assistant" | "tool",
  text: string,
  meta?: { model?: string; sourceKey?: string },
): Promise<void> {
  const c = getClient();
  if (!c) return;

  const chunks = chunkText(text);
  if (chunks.length === 0) return;

  await ensureCollection();

  const denseVectors = await embed(chunks, "document");

  let sourceKey = meta?.sourceKey;
  let supersede = Boolean(meta?.sourceKey);
  if (!sourceKey) {
    const clustered = role === "assistant" ? await findClusterSourceKey(target, denseVectors[0]) : null;
    if (clustered) {
      sourceKey = clustered;
      supersede = true;
    } else {
      sourceKey = randomUUID();
    }
  }

  if (supersede) await supersedeOldVersions(target, sourceKey);

  const ts = new Date().toISOString();
  const points = chunks.map((chunk, i) => {
    const sparse = bm25Vector(chunk);
    const vector: Record<string, unknown> = { dense: denseVectors[i] };
    if (sparse) vector.bm25 = sparse;
    const payload: MemoryPayload = {
      text: chunk,
      targetType: target.targetType,
      targetName: target.targetName,
      sourceKey: sourceKey as string,
      sessionId,
      role,
      ts,
      current: true,
      chunkIndex: i,
      ...(meta?.model ? { model: meta.model } : {}),
    };
    return { id: randomUUID(), vector, payload };
  });

  await c.upsert(config.qdrantCollection, { wait: true, points: points as never });
}

export function ingestTurn(
  target: MemoryTarget,
  sessionId: string,
  role: "user" | "assistant" | "tool",
  text: string,
  meta?: { model?: string; sourceKey?: string },
): void {
  if (!memoryEnabled() || !text || !text.trim()) return;
  ingestTurnAsync(target, sessionId, role, text, meta).catch((err) => {
    console.error(`[memory] Falha ao ingerir turno: ${err instanceof Error ? err.message : String(err)}`);
  });
}

interface RetrievedPoint {
  text: string;
  sourceKey: string;
  ts: string;
  current: boolean;
  sessionId: string;
}

async function hybridRetrieve(target: MemoryTarget, query: string): Promise<RetrievedPoint[]> {
  const c = getClient();
  if (!c) return [];

  const [denseVec] = await embed([query], "query");
  const sparse = bm25Vector(query);
  const filter = targetFilter(target);
  const candidates = config.retrieveCandidates;

  let res;
  if (sparse) {
    res = await c.query(config.qdrantCollection, {
      prefetch: [
        { query: denseVec, using: "dense", limit: candidates, filter },
        { query: { indices: sparse.indices, values: sparse.values }, using: "bm25", limit: candidates, filter },
      ],
      query: { fusion: "rrf" },
      limit: candidates,
      filter,
      with_payload: true,
      with_vector: false,
    });
  } else {
    res = await c.query(config.qdrantCollection, {
      query: denseVec,
      using: "dense",
      limit: candidates,
      filter,
      with_payload: true,
      with_vector: false,
    });
  }

  return (res.points ?? []).map((p) => {
    const payload = p.payload as unknown as MemoryPayload;
    return {
      text: payload.text,
      sourceKey: payload.sourceKey,
      ts: payload.ts,
      current: payload.current,
      sessionId: payload.sessionId,
    };
  });
}

export async function searchMemory(
  target: MemoryTarget,
  query: string,
  k = 10,
): Promise<{ text: string; sessionId: string; ts: string; current: boolean; sourceKey: string }[]> {
  if (!memoryEnabled() || !query || !query.trim()) return [];

  try {
    await ensureCollection();
    const candidates = await hybridRetrieve(target, query);
    if (candidates.length === 0) return [];

    const reranked = await rerank(query, candidates.map((c) => c.text), config.memoryDomainInstruction, Math.max(k, config.rerankTopK));
    const ordered = reranked.length > 0 ? reranked.map((r) => candidates[r.index]).filter(Boolean) : candidates;

    return ordered.slice(0, k).map((p) => ({
      text: p.text,
      sessionId: p.sessionId,
      ts: p.ts,
      current: p.current,
      sourceKey: p.sourceKey,
    }));
  } catch (err) {
    console.error(`[memory] Falha na busca: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function memoryHistory(
  target: MemoryTarget,
  sourceKey: string,
): Promise<{ text: string; ts: string; current: boolean }[]> {
  if (!memoryEnabled() || !sourceKey) return [];

  const c = getClient();
  if (!c) return [];

  try {
    await ensureCollection();
    const result: { text: string; ts: string; current: boolean }[] = [];
    let offset: unknown = undefined;
    do {
      const res = await c.scroll(config.qdrantCollection, {
        filter: {
          must: [
            { key: "sourceKey", match: { value: sourceKey } },
            { key: "targetType", match: { value: target.targetType } },
            { key: "targetName", match: { value: target.targetName } },
          ],
        },
        with_payload: true,
        with_vector: false,
        limit: 128,
        offset: offset as never,
      });
      for (const p of res.points ?? []) {
        const payload = p.payload as unknown as MemoryPayload;
        result.push({ text: payload.text, ts: payload.ts, current: payload.current });
      }
      offset = res.next_page_offset ?? undefined;
    } while (offset);

    return result.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  } catch (err) {
    console.error(`[memory] Falha ao buscar histórico: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function createMemoryMcpServer(target: MemoryTarget): ReturnType<typeof createSdkMcpServer> | null {
  if (!memoryEnabled()) return null;

  const searchTool = tool(
    "search_memory",
    "Busca na memória de longo prazo deste alvo por fatos, decisões e contexto de sessões anteriores. Retorna trechos relevantes com data e se ainda são a versão atual.",
    { query: z.string().describe("O que procurar na memória"), k: z.number().int().positive().max(50).optional().describe("Número máximo de resultados (padrão 10)") },
    async (args) => {
      const hits = await searchMemory(target, args.query, args.k ?? 10);
      if (hits.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhum registro relevante na memória." }] };
      }
      const text = hits
        .map((h) => `[${h.current ? "ATUAL" : "anterior"} · ${formatDate(h.ts)} · ${h.sourceKey}] ${h.text}`)
        .join("\n\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  const historyTool = tool(
    "memory_history",
    "Recupera todas as versões históricas de um fato específico (por sourceKey), da mais nova para a mais antiga, para entender como evoluiu.",
    { sourceKey: z.string().describe("O sourceKey do fato, obtido via search_memory") },
    async (args) => {
      const versions = await memoryHistory(target, args.sourceKey);
      if (versions.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhum histórico encontrado para este sourceKey." }] };
      }
      const text = versions
        .map((v) => `[${v.current ? "ATUAL" : "substituído"} · ${formatDate(v.ts)}] ${v.text}`)
        .join("\n\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  return createSdkMcpServer({ name: "memory", version: "1.0.0", tools: [searchTool, historyTool] });
}
