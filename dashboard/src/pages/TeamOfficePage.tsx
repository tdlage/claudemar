import { useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Settings } from "lucide-react";
import { isAdmin } from "../hooks/useAuth";
import { useTeams } from "../hooks/useTeams";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { api } from "../lib/api";
import { SquadOffice, type ZoneClick } from "../components/teams/SquadOffice";
import { FileArchiveModal } from "../components/teams/FileArchiveModal";
import { CpdMcpModal } from "../components/teams/CpdMcpModal";
import { LibrarySkillsModal } from "../components/teams/LibrarySkillsModal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
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

  const onAgentClick = useCallback((name: string) => navigate(`/agents/${name}`), [navigate]);
  const onWaitingClick = useCallback((name: string) => setAnswering(name), []);
  const onZoneClick = useCallback((zone: ZoneClick) => {
    if (zone === "archive") setArchiveOpen(true);
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
          admin={admin}
          onAgentClick={onAgentClick}
          onWaitingClick={onWaitingClick}
          onZoneClick={onZoneClick}
        />
      </div>

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
