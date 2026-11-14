import type { RowDataPacket } from "mysql2/promise";
import { execute, query, toMySQLDatetime } from "../database.js";
import type { RequestContext } from "../server/middleware.js";

interface FavoriteRow extends RowDataPacket {
  agent_name: string;
}

export function favoriteOwnerOf(ctx: RequestContext): string {
  return ctx.role === "admin" ? "admin" : ctx.userId;
}

export async function favoriteAgents(ownerId: string): Promise<Set<string>> {
  const rows = await query<FavoriteRow[]>("SELECT agent_name FROM agent_favorites WHERE owner_id = ?", [ownerId]);
  return new Set(rows.map((row) => row.agent_name));
}

export async function setFavoriteAgent(ownerId: string, agentName: string, favorite: boolean): Promise<void> {
  if (favorite) {
    await execute("INSERT IGNORE INTO agent_favorites (owner_id, agent_name, created_at) VALUES (?, ?, ?)", [ownerId, agentName, toMySQLDatetime(new Date().toISOString())]);
  } else {
    await execute("DELETE FROM agent_favorites WHERE owner_id = ? AND agent_name = ?", [ownerId, agentName]);
  }
}

export async function purgeAgentFavorites(agentName: string): Promise<void> {
  await execute("DELETE FROM agent_favorites WHERE agent_name = ?", [agentName]);
}

export async function purgeOwnerFavorites(ownerId: string): Promise<void> {
  await execute("DELETE FROM agent_favorites WHERE owner_id = ?", [ownerId]);
}
