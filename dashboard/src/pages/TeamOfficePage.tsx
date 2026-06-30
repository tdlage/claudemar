import { useState, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Settings, Send } from "lucide-react";
import { isAdmin } from "../hooks/useAuth";
import { useTeams } from "../hooks/useTeams";
import { useAgentActivity } from "../hooks/useAgentActivity";
import { useAgentPermissions } from "../hooks/useAgentPermissions";
import { useAgentScreens } from "../hooks/useAgentScreens";
import { useSocketEvent } from "../hooks/useSocket";
import { api } from "../lib/api";
import { SquadOffice, type ZoneClick, type HandoffAnim, PRESIDENT_NAME } from "../components/teams/SquadOffice";
import { FileArchiveModal } from "../components/teams/FileArchiveModal";
import { CpdMcpModal } from "../components/teams/CpdMcpModal";
import { LibrarySkillsModal } from "../components/teams/LibrarySkillsModal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { PermissionPrompt } from "../components/terminal/PermissionPrompt";
import { Terminal, type StartOpts } from "../components/terminal/Terminal";
import { Modal } from "../components/shared/Modal";
import type { ImageBlock } from "../lib/imageBlock";
import { agentColor } from "../lib/avatar";

export function TeamOfficePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const admin = isAdmin();
  const { overview, active, pendingQuestions, submitAnswer } = useTeams();
  const activities = useAgentActivity();
  const { byAgent: permsByAgent, respond: respondPermission } = useAgentPermissions();
  const { screenFor, markSeen } = useAgentScreens(active);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [zoneInfo, setZoneInfo] = useState<ZoneClick | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [permAgent, setPermAgent] = useState<string | null>(null);
  const [screenAgent, setScreenAgent] = useState<string | null>(null);
  const [presidentOpen, setPresidentOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [sending, setSending] = useState(false);
  const [handoffs, setHandoffs] = useState<HandoffAnim[]>([]);
  const handoffSeq = useRef(0);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const pushHandoff = useCallback((h: Omit<HandoffAnim, "ts">) => {
    setHandoffs((prev) => {
      const ts = ++handoffSeq.current;
      return [...prev.slice(-19), { ...h, ts }];
    });
  }, []);

  const squadMembers = useMemo(() => {
    const t = overview?.teams.find((tm) => tm.id === id);
    return new Set(t?.members.map((m) => m.agentName) ?? []);
  }, [overview, id]);

  useSocketEvent<{ teamId: string; agent: string }>("squad:dispatch", (d) => {
    if (d.teamId !== id) return;
    pushHandoff({ from: PRESIDENT_NAME, to: d.agent });
  });

  useSocketEvent<{ from: string; to: string }>("agent:handoff", (d) => {
    if (!squadMembers.has(d.from)) return;
    pushHandoff({ from: d.from, to: d.to, kind: "subagent" });
  });

  const endHandoff = useCallback((d: { info?: { targetType: string; targetName: string } }) => {
    if (d.info?.targetType !== "agent") return;
    pushHandoff({ from: d.info.targetName, to: "", cancel: true });
  }, [pushHandoff]);
  useSocketEvent("execution:complete", endHandoff);
  useSocketEvent("execution:error", endHandoff);
  useSocketEvent("execution:cancel", endHandoff);

  useSocketEvent<{ from: string; to: string }>("agent:handoff:done", (d) => {
    if (!squadMembers.has(d.from)) return;
    pushHandoff({ from: d.from, to: "", cancel: true });
  });

  const sendToPresident = useCallback(async () => {
    const text = prompt.trim();
    if (!text || sending || !id) return;
    setSending(true);
    setDispatchError(null);
    pushHandoff({ from: PRESIDENT_NAME, to: selectedAgent });
    try {
      await api.post(`/teams/${id}/dispatch`, { prompt: text, agent: selectedAgent || undefined });
      setPrompt("");
      setPresidentOpen(false);
    } catch (err) {
      setDispatchError(err instanceof Error ? err.message : "Falha ao encaminhar");
      pushHandoff({ from: PRESIDENT_NAME, to: "", cancel: true });
    } finally {
      setSending(false);
    }
  }, [prompt, selectedAgent, sending, id, pushHandoff]);

  const onAgentClick = useCallback((name: string) => navigate(`/agents/${name}`), [navigate]);
  const onWaitingClick = useCallback((name: string) => setAnswering(name), []);
  const onPermissionClick = useCallback((name: string) => setPermAgent(name), []);
  const permissionText = useCallback((name: string) => {
    const list = permsByAgent[name];
    return list && list.length > 0 ? `Permitir ${list[0].toolName}?` : null;
  }, [permsByAgent]);
  const onScreenClick = useCallback((name: string) => { setScreenAgent(name); markSeen(name); }, [markSeen]);
  const screenState = useCallback((name: string) => {
    const s = screenFor(name);
    return s ? { running: s.running, blink: s.blink } : null;
  }, [screenFor]);
  const handleScreenStart = useCallback(async (text: string, images: ImageBlock[], opts: StartOpts) => {
    if ((!text.trim() && images.length === 0) || !screenAgent) return;
    const blocks = images.length > 0 ? [...images, { type: "text" as const, text: text.trim() }] : undefined;
    await api.post("/executions", {
      targetType: "agent",
      targetName: screenAgent,
      prompt: text.trim(),
      blocks,
      planMode: opts.planMode,
      permissionMode: opts.permissionMode,
      effort: opts.effort,
    });
  }, [screenAgent]);
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
  const permPerms = permAgent ? (permsByAgent[permAgent] ?? []) : [];
  const screenSt = screenAgent ? screenFor(screenAgent) : null;
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
          permissionText={permissionText}
          screenState={screenState}
          handoffs={handoffs}
          onAgentClick={onAgentClick}
          onWaitingClick={onWaitingClick}
          onPermissionClick={onPermissionClick}
          onScreenClick={onScreenClick}
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

      <Modal
        open={!!screenAgent && !!screenSt}
        onClose={() => setScreenAgent(null)}
        title={`🖥️ ${screenAgent}${screenSt?.running ? " · em execução" : " · relatório final"}`}
        size="xl"
      >
        {screenSt && (
          <div className="h-[65vh]">
            <Terminal
              key={screenSt.execId}
              executionId={screenSt.execId}
              base={`agent:${screenAgent}`}
              isLive={screenSt.running}
              onStart={screenSt.running ? handleScreenStart : undefined}
            />
          </div>
        )}
      </Modal>

      <Modal open={!!permAgent && permPerms.length > 0} onClose={() => setPermAgent(null)} title={`🔐 Permissões · ${permAgent}`}>
        <div className="space-y-3">
          {permPerms.map((p) => (
            <PermissionPrompt key={p.reqId} request={p} onDecision={(reqId, dec) => respondPermission(p.execId, reqId, dec)} />
          ))}
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
