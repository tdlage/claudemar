import { useNavigate } from "react-router-dom";
import { Card } from "../shared/Card";
import { AvatarStack } from "./AgentAvatar";
import { agentColor } from "../../lib/avatar";
import type { TeamWithMembers, AgentAppearance } from "../../lib/types";

export function TeamCard({ team, appearances }: { team: TeamWithMembers; appearances: Record<string, AgentAppearance> }) {
  const navigate = useNavigate();
  const color = team.color ?? agentColor(team.name);
  const names = team.members.map((m) => m.agentName);
  return (
    <Card onClick={() => navigate(`/teams/${team.id}`)} className="!p-0 overflow-hidden">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg leading-none">{team.emoji ?? "🏢"}</span>
          <span className="text-sm font-semibold text-text-primary truncate">{team.name}</span>
          <span className="ml-auto text-xs text-text-muted">{team.memberCount} agente{team.memberCount === 1 ? "" : "s"}</span>
        </div>
        {team.description && <p className="text-xs text-text-muted mb-3 line-clamp-2">{team.description}</p>}
        <div className="mt-3">
          {names.length > 0 ? (
            <AvatarStack names={names} appearances={appearances} />
          ) : (
            <p className="text-xs text-text-muted">Sem membros</p>
          )}
        </div>
      </div>
    </Card>
  );
}
