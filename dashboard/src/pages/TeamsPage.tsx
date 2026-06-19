import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil } from "lucide-react";
import { isAdmin } from "../hooks/useAuth";
import { useTeams } from "../hooks/useTeams";
import { TeamCard } from "../components/teams/TeamCard";
import { CreateTeamModal } from "../components/teams/CreateTeamModal";
import { AgentAvatar } from "../components/teams/AgentAvatar";
import { AppearanceEditor } from "../components/teams/AppearanceEditor";

export function TeamsPage() {
  const { overview, reload, statusOf } = useTeams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState<string | null>(null);
  const navigate = useNavigate();
  const admin = isAdmin();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">Teams / Squads</h1>
        <div className="flex-1" />
        {admin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> Novo squad
          </button>
        )}
      </div>

      {!overview ? (
        <p className="text-text-muted text-sm">Carregando...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {overview.teams.map((team) => (
              <TeamCard key={team.id} team={team} appearances={overview.appearances} />
            ))}
            {overview.teams.length === 0 && <p className="text-text-muted text-sm">Nenhum squad ainda. Crie o primeiro.</p>}
          </div>

          <div>
            <h2 className="text-sm font-medium text-text-secondary mb-2">Soltos ({overview.loose.length})</h2>
            <div className="flex flex-wrap gap-3">
              {overview.loose.map((name) => (
                <div key={name} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1.5 rounded-md bg-surface border border-border">
                  <button onClick={() => navigate(`/agents/${name}`)} className="flex items-center gap-2">
                    <AgentAvatar name={name} appearance={overview.appearances[name]} size={24} status={statusOf(name)} />
                    <span className="text-sm text-text-secondary">{name}</span>
                  </button>
                  {admin && (
                    <button onClick={() => setEditingAvatar(name)} title="Editar avatar" className="p-1 rounded text-text-muted hover:text-accent transition-colors">
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              ))}
              {overview.loose.length === 0 && <p className="text-text-muted text-sm">Nenhum agente solto.</p>}
            </div>
          </div>
        </div>
      )}

      <CreateTeamModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(t) => { reload(); navigate(`/teams/${t.id}/office`); }} />
      {editingAvatar && (
        <AppearanceEditor agentName={editingAvatar} open onClose={() => setEditingAvatar(null)} onSaved={reload} />
      )}
    </div>
  );
}
