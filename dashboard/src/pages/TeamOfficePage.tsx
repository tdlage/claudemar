import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Settings, Send } from "lucide-react";
import { isAdmin } from "../hooks/useAuth";
import { useTeams } from "../hooks/useTeams";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { useSocketEvent } from "../hooks/useSocket";
import { api } from "../lib/api";
import { SquadOffice, type ZoneClick, type DispatchAnim } from "../components/teams/SquadOffice";
import { FileArchiveModal } from "../components/teams/FileArchiveModal";
import { CpdMcpModal } from "../components/teams/CpdMcpModal";
import { LibrarySkillsModal } from "../components/teams/LibrarySkillsModal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Modal } from "../components/shared/Modal";
import { agentColor } from "../lib/avatar";

export function TeamOfficePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const admin = isAdmin();
  const { overview, active, pendingQuestions, submitAnswer } = useTeams();
  const activities = useAgentActivity();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [zoneInfo, setZoneInfo] = useState<ZoneClick | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [presidentOpen, setPresidentOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [sending, setSending] = useState(false);
  const [dispatchAnim, setDispatchAnim] = useState<DispatchAnim | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  useSocketEvent<{ teamId: string; agent: string }>("squad:dispatch", (d) => {
    if (d.teamId !== id) return;
    setDispatchAnim({ agent: d.agent, ts: Date.now() });
  });

  const sendToPresident = useCallback(async () => {
    const text = prompt.trim();
    if (!text || sending || !id) return;
    setSending(true);
    setDispatchError(null);
    setDispatchAnim({ agent: selectedAgent, ts: Date.now() });
    try {
      await api.post(`/teams/${id}/dispatch`, { prompt: text, agent: selectedAgent || undefined });
      setPrompt("");
      setPresidentOpen(false);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Falha ao encaminhar");
      setDispatchAnim({ agent: "", ts: Date.now(), cancel: true });
    } finally {
      setSending(false);
    }
  }, [prompt, selectedAgent, sending, id]);

  const onAgentClick = useCallback((name: string) => navigate(`/agents/${name}`), [navigate]);
  const onWaitingClick = useCallback((name: string) => setAnswering(name), []);
  const onZoneClick = useCallback((zone: ZoneClick) => {
    if (zone === "archive") setArchiveOpen(true);
    else if (zone === "presidencia") setPresidentOpen(true);
    else if (admin) setZoneInfo(zone);
  }, [admin]);

  const activeNames = useMemo(
    () => new Set(active.filter((e) => e.targetType === "agent").map((e) => e.targetName)),
    [active],
  );
  const pendingFor = useCallback(
    (name: string) => pendingQuestions.find((pq) => pq.info.targetType === "agent" && pq.info.targetName === name),
    [pendingQuestions],
  );
  const pendingText = useCallback((name: string) => pendingFor(name)?.question.questions[0]?.question ?? null, [pendingFor]);

  const team = overview?.teams.find((t) => t.id === id);
  if (!overview) return <p className="text-text-muted text-sm">Carregando...</p>;
  if (!team) return <p className="text-text-muted text-sm">Squad não encontrado.</p>;

  const color = team.color ?? agentColor(team.name);
  const members = team.members.map((m) => m.agentName);
  const answeringPq = answering ? pendingFor(answering) : undefined;

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-88px)]">
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <button onClick={() => navigate("/teams")} className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-accent transition-colors">
          <ArrowLeft size={15} /> Squads
        </button>
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xl leading-none">{team.emoji ?? "🏢"}</span>
        <h1 className="text-lg font-semibold">{team.name}</h1>
        <span className="text-xs text-text-muted">{members.length} agente{members.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <Link to={`/teams/${team.id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-text-muted hover:text-accent hover:border-accent transition-colors">
          <Settings size={13} /> Configurar
        </Link>
      </div>

      <div className="flex-1 min-h-0">
        <SquadOffice
          team={team}
          appearances={overview.appearances}
          activities={activities}
          activeNames={activeNames}
          pendingText={pendingText}
          dispatch={dispatchAnim}
          onAgentClick={onAgentClick}
          onWaitingClick={onWaitingClick}
          onZoneClick={onZoneClick}
        />
      </div>

      <Modal open={presidentOpen} onClose={() => setPresidentOpen(false)} title="👔 Sala da Presidência">
        <div className="space-y-3">
          <p className="text-xs text-text-muted">
            Descreva o que precisa. O presidente encaminha ao agente mais adequado — ou escolha um agente para enviar diretamente.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendToPresident(); } }}
            placeholder="Ex.: quanto estamos gastando na AWS este mês?"
            rows={4}
            autoFocus
            className="w-full bg-surface border border-border rounded-md text-sm text-text-primary placeholder:text-text-muted px-3 py-2 outline-none focus:border-accent resize-none"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted">Encaminhar para:</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              disabled={members.length === 0}
              className="flex-1 bg-surface border border-border rounded-md text-sm text-text-primary px-2 py-1.5 outline-none focus:border-accent"
            >
              <option value="">Presidente decide</option>
              {members.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          {dispatchError && <p className="text-xs text-danger">{dispatchError}</p>}
          <div className="flex justify-end">
            <button
              onClick={sendToPresident}
              disabled={sending || !prompt.trim() || members.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              <Send size={13} /> {sending ? "Encaminhando..." : "Enviar ao presidente"}
            </button>
          </div>
        </div>
      </Modal>

      <FileArchiveModal members={members} open={archiveOpen} onClose={() => setArchiveOpen(false)} />
      <CpdMcpModal teamId={team.id} teamName={team.name} open={zoneInfo === "cpd"} onClose={() => setZoneInfo(null)} />
      <LibrarySkillsModal teamId={team.id} teamName={team.name} open={zoneInfo === "library"} onClose={() => setZoneInfo(null)} />

      {answering && answeringPq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setAnswering(null)} />
          <div className="relative w-full max-w-2xl">
            <QuestionPanel
              execId={answeringPq.execId}
              question={answeringPq.question}
              targetName={answering}
              onSubmit={(execId, answer) => { submitAnswer(execId, answer); setAnswering(null); }}
              onDismiss={(execId) => { api.post(`/executions/${execId}/stop`).catch(() => {}); setAnswering(null); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
