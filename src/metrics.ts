import { query } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

export interface AgentMetrics {
  executions: number;
  totalCostUsd: number;
  totalTokens: number;
  totalDurationMs: number;
}

export async function loadMetrics(): Promise<Record<string, AgentMetrics>> {
  const rows = await query<(RowDataPacket & { agent: string; executions: number; total_cost_usd: number; total_tokens: number; total_duration_ms: number })[]>(
    `SELECT COALESCE(agent_name, target_name) AS agent,
            COUNT(*) AS executions,
            COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(duration_ms), 0) AS total_duration_ms
     FROM execution_history
     WHERE target_type = 'agent'
     GROUP BY COALESCE(agent_name, target_name)`,
  );

  const result: Record<string, AgentMetrics> = {};
  for (const row of rows) {
    result[row.agent] = {
      executions: Number(row.executions),
      totalCostUsd: Number(row.total_cost_usd),
      totalTokens: Number(row.total_tokens),
      totalDurationMs: Number(row.total_duration_ms),
    };
  }
  return result;
}
