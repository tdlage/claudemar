import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, Gamepad2, Plus } from "lucide-react";
import { api } from "../lib/api";
import { isAdmin } from "../hooks/useAuth";
import { useCachedState } from "../hooks/useCachedState";
import { useTeams } from "../hooks/useTeams";
import { TeamCard } from "../components/teams/TeamCard";
import { CreateTeamModal } from "../components/teams/CreateTeamModal";
import { PixelOffice } from "../components/teams/PixelOffice";
import { AgentAvatar } from "../components/teams/AgentAvatar";

type View = "grid" | "office";

export function TeamsPage() {
  const { overview, reload, statusOf } = useTeams();
  const [view, setView] = useCachedState<View>("teams:view", "office");
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const admin = isAdmin();

  const move = async (agent: string, teamId: string | null) => {
    try {
      if (teamId) {
        await api.put(`/teams/${teamId}/members/${agent}`);
      } else {
        const current = overview?.teams.find((t) => t.members.some((m) => m.agentName === agent));
        if (current) await api.delete(`/teams/${current.id}/members/${agent}`);
      }
      reload();
    } catch { /* refresh via socket */ }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">Teams / Squads</h1>
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView("grid")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${view === "grid" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
          >
            <LayoutGrid size={13} /> Lista
          </button>
          <button
            onClick={() => setView("office")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${view === "office" ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
          >
            <Gamepad2 size={13} /> Escritório
          </button>
        </div>
        <div className="flex-1" />
        {admin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> Novo time
          </button>
        )}
      </div>

      {admin && view === "office" && (
        <p className="text-xs text-text-muted">Arraste um agente entre as salas para trocá-lo de time. Agentes de times diferentes não podem se comunicar entre si.</p>
      )}

      {!overview ? (
        <p className="text-text-muted text-sm">Carregando...</p>
      ) : view === "office" ? (
        <PixelOffice overview={overview} statusOf={statusOf} admin={admin} onMove={move} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {overview.teams.map((team) => (
              <TeamCard key={team.id} team={team} appearances={overview.appearances} />
            ))}
            {overview.teams.length === 0 && <p className="text-text-muted text-sm">Nenhum time ainda.</p>}
          </div>
          <div>
            <h2 className="text-sm font-medium text-text-secondary mb-2">Soltos ({overview.loose.length})</h2>
            <div className="flex flex-wrap gap-3">
              {overview.loose.map((name) => (
                <button
                  key={name}
                  onClick={() => navigate(`/agents/${name}`)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface border border-border hover:border-border-hover transition-colors"
                >
                  <AgentAvatar name={name} appearance={overview.appearances[name]} size={24} status={statusOf(name)} />
                  <span className="text-sm text-text-secondary">{name}</span>
                </button>
              ))}
              {overview.loose.length === 0 && <p className="text-text-muted text-sm">Nenhum agente solto.</p>}
            </div>
          </div>
        </div>
      )}

      <CreateTeamModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(t) => { reload(); navigate(`/teams/${t.id}`); }} />
    </div>
  );
}
