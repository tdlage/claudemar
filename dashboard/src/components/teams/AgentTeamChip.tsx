import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useSocketEvent } from "../../hooks/useSocket";
import { agentColor } from "../../lib/avatar";

interface AgentTeam { id: string; name: string; emoji: string | null; color: string | null }

export function AgentTeamChip({ agentName }: { agentName: string }) {
  const [team, setTeam] = useState<AgentTeam | null | undefined>(undefined);

  const load = useCallback(() => {
    api.get<{ team: AgentTeam | null }>(`/agents/${agentName}/team`)
      .then((r) => setTeam(r.team))
      .catch(() => setTeam(null));
  }, [agentName]);

  useEffect(() => { load(); }, [load]);
  useSocketEvent("team:updated", load);

  if (team === undefined) return null;

  if (!team) {
    return (
      <Link to="/teams" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-border text-text-muted hover:text-text-secondary transition-colors">
        🛋️ Sem time
      </Link>
    );
  }

  const color = team.color ?? agentColor(team.name);
  return (
    <Link
      to={`/teams/${team.id}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors"
      style={{ borderColor: `${color}66`, backgroundColor: `${color}22`, color }}
      title={`Time: ${team.name}`}
    >
      <span>{team.emoji ?? "🏢"}</span>
      {team.name}
    </Link>
  );
}
