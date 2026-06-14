import { query, execute, toMySQLDatetime } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

export interface HistoryEntry {
  id: string;
  prompt: string;
  targetType: string;
  targetName: string;
  agentName?: string;
  model?: string;
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
}

interface HistoryRow extends RowDataPacket {
  id: string;
  prompt: string;
  target_type: string;
  target_name: string;
  agent_name: string | null;
  model: string | null;
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
  };
}

export function appendHistory(entry: HistoryEntry): void {
  execute(
    `INSERT INTO execution_history (id, prompt, target_type, target_name, agent_name, model, status, started_at, completed_at, cost_usd, total_tokens, duration_ms, source, output, error, session_id, plan_mode, username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id, entry.prompt, entry.targetType, entry.targetName,
      entry.agentName ?? null, entry.model ?? null, entry.status, toMySQLDatetime(entry.startedAt), entry.completedAt ? toMySQLDatetime(entry.completedAt) : null,
      entry.costUsd ?? 0, entry.totalTokens ?? 0, entry.durationMs ?? 0, entry.source ?? "telegram",
      entry.output ?? null, entry.error ?? null, entry.sessionId ?? null,
      entry.planMode ? 1 : 0, entry.username ?? null,
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

export async function loadSessionIds(targetType: string, targetName: string): Promise<string[]> {
  const rows = await loadSessionRefs(targetType, targetName);
  return rows.map((r) => r.sessionId);
}

export type SessionProvider = "codex" | "claude";

export interface SessionRef {
  sessionId: string;
  model: string;
  provider: SessionProvider;
}

function inferProvider(model: string | null, costUsd: number): SessionProvider {
  if (model?.startsWith("claude")) return "claude";
  if (model === "claude") return "claude";
  if (!model && costUsd > 0) return "claude";
  return "codex";
}

export async function loadSessionRefs(targetType: string, targetName: string, provider?: SessionProvider): Promise<SessionRef[]> {
  const rows = await query<(RowDataPacket & { session_id: string; model: string | null; cost_usd: number })[]>(
    `SELECT session_id, model, cost_usd FROM (
       SELECT session_id, model, cost_usd, started_at,
              ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY started_at DESC) AS rn
       FROM execution_history
       WHERE target_type = ? AND target_name = ? AND session_id IS NOT NULL
     ) sub WHERE rn = 1 ORDER BY started_at DESC`,
    [targetType, targetName],
  );
  const refs = rows.map((r) => {
    const inferredProvider = inferProvider(r.model, Number(r.cost_usd));
    return {
      sessionId: r.session_id,
      model: r.model ?? inferredProvider,
      provider: inferredProvider,
    };
  });
  return provider ? refs.filter((r) => r.provider === provider) : refs;
}
