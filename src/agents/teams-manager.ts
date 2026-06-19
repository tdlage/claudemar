import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { RowDataPacket } from "mysql2/promise";
import { query, execute, toMySQLDatetime } from "../database.js";
import { listAgents } from "./manager.js";

export const teamEvents = new EventEmitter();

function emitChanged(): void {
  teamEvents.emit("changed");
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  emoji: string | null;
  createdAt: string;
  memberCount: number;
}

export interface TeamMember {
  agentName: string;
  role: string;
}

export interface AgentAppearance {
  color: string | null;
  emoji: string | null;
}

type TeamRow = RowDataPacket & {
  id: string; name: string; description: string | null;
  color: string | null; emoji: string | null; created_at: Date; member_count: number;
};
type MemberRow = RowDataPacket & { agent_name: string; team_id: string; role: string };
type AppearanceRow = RowDataPacket & { agent_name: string; color: string | null; emoji: string | null };

const membership = new Map<string, string>();
let membershipLoaded = false;

export async function initTeams(): Promise<void> {
  const rows = await query<MemberRow[]>("SELECT agent_name, team_id FROM team_members");
  membership.clear();
  for (const row of rows) membership.set(row.agent_name, row.team_id);
  membershipLoaded = true;
}

function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    emoji: row.emoji,
    createdAt: new Date(row.created_at).toISOString(),
    memberCount: Number(row.member_count),
  };
}

export async function listTeams(): Promise<Team[]> {
  const rows = await query<TeamRow[]>(
    `SELECT t.id, t.name, t.description, t.color, t.emoji, t.created_at,
            COUNT(m.agent_name) AS member_count
     FROM teams t LEFT JOIN team_members m ON m.team_id = t.id
     GROUP BY t.id ORDER BY t.name`,
  );
  return rows.map(mapTeam);
}

export async function getTeam(id: string): Promise<Team | null> {
  const rows = await query<TeamRow[]>(
    `SELECT t.id, t.name, t.description, t.color, t.emoji, t.created_at,
            COUNT(m.agent_name) AS member_count
     FROM teams t LEFT JOIN team_members m ON m.team_id = t.id
     WHERE t.id = ? GROUP BY t.id`,
    [id],
  );
  return rows[0] ? mapTeam(rows[0]) : null;
}

export async function createTeam(input: { name: string; description?: string; color?: string; emoji?: string }): Promise<Team> {
  const id = randomUUID();
  await execute(
    "INSERT INTO teams (id, name, description, color, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.name, input.description ?? null, input.color ?? null, input.emoji ?? null, toMySQLDatetime(new Date().toISOString())],
  );
  emitChanged();
  return (await getTeam(id))!;
}

export async function updateTeam(id: string, fields: { name?: string; description?: string | null; color?: string | null; emoji?: string | null }): Promise<Team | null> {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  for (const key of ["name", "description", "color", "emoji"] as const) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key] as string | null);
    }
  }
  if (sets.length > 0) {
    params.push(id);
    await execute(`UPDATE teams SET ${sets.join(", ")} WHERE id = ?`, params);
    emitChanged();
  }
  return getTeam(id);
}

export async function deleteTeam(id: string): Promise<void> {
  await execute("DELETE FROM teams WHERE id = ?", [id]);
  for (const [agent, teamId] of membership) {
    if (teamId === id) membership.delete(agent);
  }
  emitChanged();
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const rows = await query<MemberRow[]>(
    "SELECT agent_name, role FROM team_members WHERE team_id = ? ORDER BY agent_name",
    [teamId],
  );
  return rows.map((r) => ({ agentName: r.agent_name, role: r.role }));
}

export function getTeamOfAgent(agentName: string): string | null {
  return membership.get(agentName) ?? null;
}

export async function setAgentTeam(agentName: string, teamId: string, role = "member"): Promise<void> {
  await execute(
    `INSERT INTO team_members (agent_name, team_id, role, joined_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE team_id = VALUES(team_id), role = VALUES(role)`,
    [agentName, teamId, role, toMySQLDatetime(new Date().toISOString())],
  );
  membership.set(agentName, teamId);
  emitChanged();
}

export async function removeAgentFromTeam(agentName: string): Promise<void> {
  await execute("DELETE FROM team_members WHERE agent_name = ?", [agentName]);
  membership.delete(agentName);
  emitChanged();
}

export async function removeAgentData(agentName: string): Promise<void> {
  await removeAgentFromTeam(agentName);
  await execute("DELETE FROM agent_appearance WHERE agent_name = ?", [agentName]);
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
  emitChanged();
}

export function teammatesOf(agentName: string): string[] {
  if (!membershipLoaded) return [];
  const teamId = membership.get(agentName);
  if (teamId) {
    const mates: string[] = [];
    for (const [agent, id] of membership) {
      if (id === teamId && agent !== agentName) mates.push(agent);
    }
    return mates;
  }
  return listAgents().filter((name) => name !== agentName && !membership.has(name));
}
