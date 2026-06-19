import { useNavigate } from "react-router-dom";
import { Settings } from "lucide-react";
import { Card } from "../shared/Card";
import { AvatarStack } from "./AgentAvatar";
import { agentColor } from "../../lib/avatar";
import type { TeamWithMembers, AgentAppearance } from "../../lib/types";

export function TeamCard({ team, appearances }: { team: TeamWithMembers; appearances: Record<string, AgentAppearance> }) {
  const navigate = useNavigate();
  const color = team.color ?? agentColor(team.name);
  const names = team.members.map((m) => m.agentName);
  return (
    <Card onClick={() => navigate(`/teams/${team.id}/office`)} className="!p-0 overflow-hidden group">
      <div className="h-1.5" style={{ backgroundColor: color }} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg leading-none">{team.emoji ?? "🏢"}</span>
          <span className="text-sm font-semibold text-text-primary truncate">{team.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/teams/${team.id}`); }}
            title="Configurar squad"
            className="ml-auto text-text-muted hover:text-accent transition-colors"
          >
            <Settings size={15} />
          </button>
        </div>
        {team.description && <p className="text-xs text-text-muted mb-3 line-clamp-2">{team.description}</p>}
        <div className="mt-3 flex items-center justify-between">
          {names.length > 0 ? (
            <AvatarStack names={names} appearances={appearances} />
          ) : (
            <p className="text-xs text-text-muted">Sem membros</p>
          )}
          <span className="text-xs text-text-muted">{team.memberCount} agente{team.memberCount === 1 ? "" : "s"}</span>
        </div>
        <p className="mt-3 text-[11px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">Abrir escritório →</p>
      </div>
    </Card>
  );
}
