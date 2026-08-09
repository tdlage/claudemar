import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { telemetryDir } from "./paths.js";
import { dayKeyInTz } from "./text.js";
import type { BrainDegraded } from "./types.js";

export interface RecallLine {
  ts: string;
  surface: string;
  tool: string;
  scope: { targetType: "brain"; targetName: string };
  query: string;
  requested: number;
  candidates_rrf: number;
  returned_ids: string[];
  top_rerank_score: number | null;
  min_rerank_score: number | null;
  duration_ms: number;
  degraded: string | null;
  ranked?: boolean;
}

export function buildRecallLine(params: {
  surface: string;
  tool: string;
  targetName: string;
  query: string;
  requested: number;
  candidatesRrf: number;
  returnedIds: string[];
  topRerankScore: number | null;
  minRerankScore: number | null;
  durationMs: number;
  degraded: BrainDegraded[];
  ranked?: boolean;
}): RecallLine {
  return {
    ts: new Date().toISOString(),
    surface: params.surface,
    tool: params.tool,
    scope: { targetType: "brain", targetName: params.targetName },
    query: params.query,
    requested: params.requested,
    candidates_rrf: params.candidatesRrf,
    returned_ids: params.returnedIds,
    top_rerank_score: params.topRerankScore,
    min_rerank_score: params.minRerankScore,
    duration_ms: params.durationMs,
    degraded: params.degraded.length > 0 ? params.degraded.join("+") : null,
    ...(params.ranked ? { ranked: true } : {}),
  };
}

function monthFile(month: string): string {
  return resolve(telemetryDir, `recall-${month}.jsonl`);
}

export async function appendRecallLine(line: RecallLine): Promise<void> {
  const month = dayKeyInTz(new Date(), config.brainTz).slice(0, 7);
  try {
    await appendFile(monthFile(month), `${JSON.stringify(line)}\n`, "utf-8");
  } catch (err) {
    console.error("[brain:telemetry] falha ao gravar recall:", err instanceof Error ? err.message : String(err));
  }
}

export async function readRecallTail(month: string | undefined, limit: number): Promise<RecallLine[]> {
  const target = month && /^\d{4}-\d{2}$/.test(month) ? month : dayKeyInTz(new Date(), config.brainTz).slice(0, 7);
  const path = monthFile(target);
  if (!existsSync(path)) return [];
  const content = await readFile(path, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const out: RecallLine[] = [];
  for (const raw of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(raw) as RecallLine);
    } catch {}
  }
  return out.reverse();
}

const BIN_COUNT = 10;

export interface RecallDistribution {
  month: string;
  total: number;
  scored: number;
  bins: { from: number; to: number; count: number }[];
  percentiles: { p25: number | null; p50: number | null; p75: number | null };
}

function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length));
  return sorted[idx];
}

export async function readRecallDistribution(month: string | undefined): Promise<RecallDistribution> {
  const target = month && /^\d{4}-\d{2}$/.test(month) ? month : dayKeyInTz(new Date(), config.brainTz).slice(0, 7);
  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({ from: i / BIN_COUNT, to: (i + 1) / BIN_COUNT, count: 0 }));
  const scores: number[] = [];
  let total = 0;
  const path = monthFile(target);
  if (existsSync(path)) {
    const content = await readFile(path, "utf-8");
    for (const raw of content.split("\n")) {
      if (!raw) continue;
      let line: RecallLine;
      try {
        line = JSON.parse(raw) as RecallLine;
      } catch {
        continue;
      }
      total += 1;
      const score = line.top_rerank_score;
      if (typeof score !== "number" || !Number.isFinite(score)) continue;
      const clamped = Math.min(0.9999, Math.max(0, score));
      bins[Math.floor(clamped * BIN_COUNT)].count += 1;
      scores.push(clamped);
    }
  }
  scores.sort((a, b) => a - b);
  return {
    month: target,
    total,
    scored: scores.length,
    bins,
    percentiles: { p25: percentile(scores, 0.25), p50: percentile(scores, 0.5), p75: percentile(scores, 0.75) },
  };
}
