import { query, execute, toMySQLDatetime } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";
import { inferRuntimeFromModel } from "./models-discovery.js";
import type { AgentRuntime } from "./providers/llm.js";
import { EFFORTS, type Effort } from "./runtime/types.js";

export interface HistoryEntry {
  id: string;
  prompt: string;
  targetType: string;
  targetName: string;
  agentName?: string;
  model?: string;
  runtime?: AgentRuntime;
  status: string;
  startedAt: string;
  completedAt: string | null;
  costUsd: number;
  totalTokens: number;
  durationMs: number;
  source: string;
  output?: string;
  error?: string | null;
  sessionId?: string;
  planMode?: boolean;
  username?: string;
  effort?: Effort;
  effortAuto?: boolean;
}

interface HistoryRow extends RowDataPacket {
  id: string;
  prompt: string;
  target_type: string;
  target_name: string;
  agent_name: string | null;
  model: string | null;
  runtime: string | null;
  status: string;
  started_at: string | Date;
  completed_at: string | Date | null;
  cost_usd: number;
  total_tokens: number;
  duration_ms: number;
  source: string;
  output: string | null;
  error: string | null;
  session_id: string | null;
  plan_mode: number;
  username: string | null;
  effort: string | null;
  effort_auto: number | null;
}

function rowToEntry(row: HistoryRow): HistoryEntry {
  const startedAt = row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at);
  const completedAt = row.completed_at
    ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at))
    : null;
  return {
    id: row.id,
    prompt: row.prompt,
    targetType: row.target_type,
    targetName: row.target_name,
    agentName: row.agent_name ?? undefined,
    model: row.model ?? undefined,
    runtime: row.runtime === "codex" || row.runtime === "claude" ? row.runtime : inferRuntimeFromModel(row.model),
    status: row.status,
    startedAt,
    completedAt,
    costUsd: Number(row.cost_usd),
    totalTokens: Number(row.total_tokens),
    durationMs: Number(row.duration_ms),
    source: row.source,
    output: row.output ?? undefined,
    error: row.error,
    sessionId: row.session_id ?? undefined,
    planMode: row.plan_mode === 1 ? true : undefined,
    username: row.username ?? undefined,
    effort: EFFORTS.includes(row.effort as Effort) ? (row.effort as Effort) : undefined,
    effortAuto: row.effort_auto === 1 ? true : undefined,
  };
}

export function appendHistory(entry: HistoryEntry): void {
  execute(
    `INSERT INTO execution_history (id, prompt, target_type, target_name, agent_name, model, runtime, status, started_at, completed_at, cost_usd, total_tokens, duration_ms, source, output, error, session_id, plan_mode, username, effort, effort_auto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id, entry.prompt, entry.targetType, entry.targetName,
      entry.agentName ?? null, entry.model ?? null, entry.runtime ?? inferRuntimeFromModel(entry.model), entry.status, toMySQLDatetime(entry.startedAt), entry.completedAt ? toMySQLDatetime(entry.completedAt) : null,
      entry.costUsd ?? 0, entry.totalTokens ?? 0, entry.durationMs ?? 0, entry.source ?? "telegram",
      entry.output ?? null, entry.error ?? null, entry.sessionId ?? null,
      entry.planMode ? 1 : 0, entry.username ?? null,
      entry.effort ?? null, entry.effortAuto ? 1 : 0,
    ],
  ).catch((err) => console.error("[history] append failed:", err));
}

export async function loadHistory(limit = 20, targetType?: string, targetName?: string, sessionId?: string, search?: string): Promise<HistoryEntry[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  const safeLimit = Math.max(1, Math.floor(Number(limit)));

  if (targetType && targetName) {
    conditions.push("target_type = ? AND target_name = ?");
    params.push(targetType, targetName);
  }
  if (sessionId) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }
  if (search) {
    conditions.push("(prompt LIKE ? OR output LIKE ?)");
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM (SELECT * FROM execution_history ${where} ORDER BY started_at DESC LIMIT ${safeLimit}) AS sub ORDER BY started_at ASC`;

  const rows = await query<HistoryRow[]>(sql, params);
  return rows.map(rowToEntry);
}

export interface SessionRef {
  sessionId: string;
  model: string;
  runtime: AgentRuntime;
}

export async function loadTargetLastUsed(targetType: string): Promise<Map<string, string>> {
  const rows = await query<(RowDataPacket & { target_name: string; last_used_at: string })[]>(
    `SELECT target_name, DATE_FORMAT(MAX(started_at), '%Y-%m-%dT%H:%i:%s.%fZ') AS last_used_at
     FROM execution_history WHERE target_type = ? GROUP BY target_name`,
    [targetType],
  );
  return new Map(rows.map((row) => [row.target_name, new Date(row.last_used_at).toISOString()]));
}

export async function loadSessionRefs(targetType: string, targetName: string): Promise<SessionRef[]> {
  const rows = await query<(RowDataPacket & { session_id: string; model: string | null; runtime: string | null })[]>(
    `SELECT session_id, model, runtime FROM (
       SELECT session_id, model, runtime, started_at,
              ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY started_at DESC) AS rn
       FROM execution_history
       WHERE target_type = ? AND target_name = ? AND session_id IS NOT NULL
     ) sub WHERE rn = 1 ORDER BY started_at DESC`,
    [targetType, targetName],
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    model: r.model ?? "opus",
    runtime: r.runtime === "codex" || r.runtime === "claude" ? r.runtime : inferRuntimeFromModel(r.model),
  }));
}

const MAX_BATCH = 500;

function batchLimit(limit: number): number {
  return Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(limit))));
}

export async function loadHistoryFinishedSince(sinceIso: string, limit: number): Promise<HistoryEntry[]> {
  const rows = await query<HistoryRow[]>(
    `SELECT * FROM execution_history
     WHERE COALESCE(completed_at, started_at) >= ?
     ORDER BY COALESCE(completed_at, started_at) ASC, id ASC
     LIMIT ${batchLimit(limit)}`,
    [toMySQLDatetime(sinceIso)],
  );
  return rows.map(rowToEntry);
}

export async function loadHistoryStartedBetween(
  fromIso: string,
  toIso: string,
  afterId: string | null,
  limit: number,
): Promise<HistoryEntry[]> {
  const rows = await query<HistoryRow[]>(
    `SELECT * FROM execution_history
     WHERE started_at >= ? AND started_at < ? AND (? IS NULL OR id > ?)
     ORDER BY id ASC
     LIMIT ${batchLimit(limit)}`,
    [toMySQLDatetime(fromIso), toMySQLDatetime(toIso), afterId, afterId],
  );
  return rows.map(rowToEntry);
}

export async function countHistoryStartedSince(fromIso: string): Promise<number> {
  const rows = await query<(RowDataPacket & { total: number })[]>(
    "SELECT COUNT(*) AS total FROM execution_history WHERE started_at >= ?",
    [toMySQLDatetime(fromIso)],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function loadSessionPrompts(
  sessionId: string,
): Promise<{ id: string; prompt: string; completedAt: string | null }[]> {
  const rows = await query<(RowDataPacket & { id: string; prompt: string; completed_at: Date | string | null })[]>(
    "SELECT id, prompt, completed_at FROM execution_history WHERE session_id = ? ORDER BY started_at ASC, id ASC",
    [sessionId],
  );
  return rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    completedAt: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)) : null,
  }));
}

export async function sessionsWithHistory(sessionIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < sessionIds.length; i += MAX_BATCH) {
    const chunk = sessionIds.slice(i, i + MAX_BATCH);
    if (chunk.length === 0) continue;
    const rows = await query<(RowDataPacket & { session_id: string })[]>(
      `SELECT DISTINCT session_id FROM execution_history WHERE session_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const row of rows) found.add(row.session_id.toLowerCase());
  }
  return found;
}

export interface TargetHistorySummary {
  executions: number;
  sessions: number;
  firstAt: string | null;
  lastAt: string | null;
  costUsd: number;
  byRuntime: Record<string, number>;
  byStatus: Record<string, number>;
  recent: Pick<HistoryEntry, "id" | "prompt" | "status" | "startedAt" | "runtime" | "model" | "sessionId" | "source" | "username">[];
}

export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function summarizeTargetHistory(
  targetType: string,
  targetName: string | null,
  recentLimit: number,
): Promise<TargetHistorySummary> {
  const where = targetName === null
    ? "target_type = ?"
    : "target_type = ? AND (target_name = ? OR target_name LIKE ?)";
  const params = targetName === null
    ? [targetType]
    : [targetType, targetName, `${likeEscape(`__commitpush:${targetName}:`)}%`];
  const totals = await query<(RowDataPacket & {
    executions: number;
    sessions: number;
    first_at: Date | string | null;
    last_at: Date | string | null;
    cost: number | null;
  })[]>(
    `SELECT COUNT(*) AS executions, COUNT(DISTINCT session_id) AS sessions,
            MIN(started_at) AS first_at, MAX(started_at) AS last_at, SUM(cost_usd) AS cost
     FROM execution_history WHERE ${where}`,
    params,
  );
  const grouped = await query<(RowDataPacket & { runtime: string | null; status: string; total: number })[]>(
    `SELECT runtime, status, COUNT(*) AS total FROM execution_history WHERE ${where} GROUP BY runtime, status`,
    params,
  );
  const recentRows = await query<HistoryRow[]>(
    `SELECT id, prompt, status, started_at, runtime, model, session_id, source, username, target_type, target_name
     FROM execution_history WHERE ${where} ORDER BY started_at DESC LIMIT ${batchLimit(recentLimit)}`,
    params,
  );
  const iso = (value: Date | string | null | undefined): string | null =>
    value ? (value instanceof Date ? value.toISOString() : String(value)) : null;
  const byRuntime: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of grouped) {
    const runtime = row.runtime ?? "desconhecido";
    byRuntime[runtime] = (byRuntime[runtime] ?? 0) + Number(row.total);
    byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.total);
  }
  const total = totals[0];
  return {
    executions: Number(total?.executions ?? 0),
    sessions: Number(total?.sessions ?? 0),
    firstAt: iso(total?.first_at),
    lastAt: iso(total?.last_at),
    costUsd: Number(total?.cost ?? 0),
    byRuntime,
    byStatus,
    recent: recentRows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      status: row.status,
      startedAt: iso(row.started_at) ?? "",
      runtime: row.runtime === "codex" || row.runtime === "claude" ? row.runtime : inferRuntimeFromModel(row.model),
      model: row.model ?? undefined,
      sessionId: row.session_id ?? undefined,
      source: row.source,
      username: row.username ?? undefined,
    })),
  };
}
