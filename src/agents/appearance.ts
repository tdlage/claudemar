import type { RowDataPacket } from "mysql2/promise";
import { execute, query } from "../database.js";

export interface AgentAppearance {
  color: string | null;
  emoji: string | null;
}

interface AppearanceRow extends RowDataPacket {
  agent_name: string;
  color: string | null;
  emoji: string | null;
}

export async function getAppearance(agentName: string): Promise<AgentAppearance> {
  const rows = await query<AppearanceRow[]>("SELECT color, emoji FROM agent_appearance WHERE agent_name = ?", [agentName]);
  return rows[0] ? { color: rows[0].color, emoji: rows[0].emoji } : { color: null, emoji: null };
}

export async function getAllAppearances(): Promise<Record<string, AgentAppearance>> {
  const rows = await query<AppearanceRow[]>("SELECT agent_name, color, emoji FROM agent_appearance");
  const result: Record<string, AgentAppearance> = {};
  for (const row of rows) result[row.agent_name] = { color: row.color, emoji: row.emoji };
  return result;
}

export async function setAppearance(agentName: string, appearance: AgentAppearance): Promise<void> {
  await execute(
    `INSERT INTO agent_appearance (agent_name, color, emoji) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE color = VALUES(color), emoji = VALUES(emoji)`,
    [agentName, appearance.color ?? null, appearance.emoji ?? null],
  );
}

export async function deleteAppearance(agentName: string): Promise<void> {
  await execute("DELETE FROM agent_appearance WHERE agent_name = ?", [agentName]);
}
