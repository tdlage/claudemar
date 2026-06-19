import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Trash2, Crown, UserMinus, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { isAdmin } from "../hooks/useAuth";
import { useCachedState } from "../hooks/useCachedState";
import { useTeams } from "../hooks/useTeams";
import { Tabs } from "../components/shared/Tabs";
import { AgentAvatar } from "../components/teams/AgentAvatar";
import { AppearanceEditor } from "../components/teams/AppearanceEditor";
import { agentColor } from "../lib/avatar";
import { TEAM_COLORS as COLORS, TEAM_EMOJIS as EMOJIS } from "../lib/teamStyle";

type TabKey = "members" | "appearance" | "activity";

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const admin = isAdmin();
  const { overview, reload, statusOf, recent } = useTeams();
  const [tab, setTab] = useCachedState<TabKey>(`team:${id}:tab`, "members");
  const [editingAvatar, setEditingAvatar] = useState<string | null>(null);

  const team = overview?.teams.find((t) => t.id === id);
  if (!overview) return <p className="text-text-muted text-sm">Carregando...</p>;
  if (!team) return <p className="text-text-muted text-sm">Time não encontrado.</p>;

  const color = team.color ?? agentColor(team.name);
  const memberNames = team.members.map((m) => m.agentName);

  const addMember = async (agent: string) => { await api.put(`/teams/${id}/members/${agent}`).catch(() => {}); reload(); };
  const removeMember = async (agent: string) => { await api.delete(`/teams/${id}/members/${agent}`).catch(() => {}); reload(); };
  const toggleLead = async (agent: string, current: string) => {
    await api.put(`/teams/${id}/members/${agent}`, { role: current === "lead" ? "member" : "lead" }).catch(() => {});
    reload();
  };
  const saveTeam = async (fields: Record<string, unknown>) => { await api.put(`/teams/${id}`, fields).catch(() => {}); reload(); };
  const removeTeam = async () => {
    if (!confirm(`Excluir o time "${team.name}"? Os agentes voltam a ficar soltos.`)) return;
    await api.delete(`/teams/${id}`).catch(() => {});
    navigate("/teams");
  };
  const memberActivity = recent
    .filter((e) => e.targetType === "agent" && memberNames.includes(e.targetName))
    .slice(-30).reverse();

  const tabs = [
    { key: "members" as const, label: `Membros (${memberNames.length})` },
    { key: "appearance" as const, label: "Aparência" },
    { key: "activity" as const, label: "Atividade" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/teams" className="text-xs text-text-muted hover:text-accent">← Teams</Link>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-2xl leading-none">{team.emoji ?? "🏢"}</span>
        <h1 className="text-lg font-semibold">{team.name}</h1>
        {team.description && <span className="text-sm text-text-muted">— {team.description}</span>}
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "members" && (
        <div className="space-y-5">
          <div className="space-y-2">
            {team.members.map((m) => (
              <div key={m.agentName} className="flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2">
                <AgentAvatar name={m.agentName} appearance={overview.appearances[m.agentName]} size={32} status={statusOf(m.agentName)} />
                <Link to={`/agents/${m.agentName}`} className="text-sm text-text-primary hover:text-accent">{m.agentName}</Link>
                {m.role === "lead" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium">lead</span>}
                {admin && (
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => toggleLead(m.agentName, m.role)} title="Alternar lead" className="p-1.5 rounded text-text-muted hover:text-warning hover:bg-surface-hover transition-colors">
                      <Crown size={14} />
                    </button>
                    <button onClick={() => removeMember(m.agentName)} title="Remover do time" className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-surface-hover transition-colors">
                      <UserMinus size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {memberNames.length === 0 && <p className="text-sm text-text-muted">Nenhum membro.</p>}
          </div>

          {admin && overview.loose.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-text-secondary mb-2">Adicionar agente solto</h2>
              <div className="flex flex-wrap gap-2">
                {overview.loose.map((name) => (
                  <button
                    key={name}
                    onClick={() => addMember(name)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface border border-border hover:border-accent text-sm text-text-secondary transition-colors"
                  >
                    <UserPlus size={13} /> {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "appearance" && (
        <div className="space-y-6 max-w-xl">
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-text-secondary">Time</h2>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button key={e} disabled={!admin} onClick={() => saveTeam({ emoji: e })}
                  className={`w-8 h-8 rounded-md text-lg flex items-center justify-center transition-colors ${team.emoji === e ? "bg-accent/20 ring-1 ring-accent" : "bg-bg hover:bg-surface-hover"} disabled:opacity-50`}>
                  {e}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button key={c} disabled={!admin} onClick={() => saveTeam({ color: c })}
                  className={`w-8 h-8 rounded-md transition-transform ${team.color === c ? "ring-2 ring-white scale-110" : ""} disabled:opacity-50`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-medium text-text-secondary">Avatares dos membros</h2>
            {team.members.map((m) => (
              <div key={m.agentName} className="flex items-center gap-3">
                <AgentAvatar name={m.agentName} appearance={overview.appearances[m.agentName]} size={28} />
                <span className="text-sm text-text-secondary flex-1 truncate">{m.agentName}</span>
                {admin && (
                  <button onClick={() => setEditingAvatar(m.agentName)}
                    className="text-xs px-2 py-1 rounded-md border border-border text-text-muted hover:text-accent hover:border-accent transition-colors">
                    Editar avatar
                  </button>
                )}
              </div>
            ))}
            {team.members.length === 0 && <p className="text-sm text-text-muted">Nenhum membro.</p>}
          </div>

          {admin && (
            <button onClick={removeTeam} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-danger/15 text-danger hover:bg-danger/25 transition-colors">
              <Trash2 size={14} /> Excluir time
            </button>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-2">
          {memberActivity.length === 0 && <p className="text-sm text-text-muted">Sem atividade recente dos membros.</p>}
          {memberActivity.map((e) => (
            <div key={e.id} className="flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2">
              <AgentAvatar name={e.targetName} appearance={overview.appearances[e.targetName]} size={24} />
              <span className="text-sm text-text-secondary w-28 truncate">{e.targetName}</span>
              <span className="flex-1 text-sm text-text-muted truncate">{e.prompt}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${e.status === "error" ? "bg-danger/15 text-danger" : "bg-success/15 text-success"}`}>{e.status}</span>
            </div>
          ))}
        </div>
      )}

      {editingAvatar && (
        <AppearanceEditor agentName={editingAvatar} open onClose={() => setEditingAvatar(null)} onSaved={reload} />
      )}
    </div>
  );
}
