import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ListOrdered, Zap, FileText, CalendarClock, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { ErrorState, LoadingState } from "../components/shared/PageState";
import { WORKSPACES_CHANGED_EVENT } from "../lib/workspaceEvents";
import { Modal } from "../components/shared/Modal";
import { Button } from "../components/shared/Button";
import { Terminal, type StartOpts } from "../components/terminal/Terminal";
import { ConversationWorkspace } from "../components/terminal/ConversationWorkspace";
import type { ImageBlock } from "../lib/imageBlock";
import { ExecutionActivity } from "../components/terminal/ExecutionActivity";
import { Tabs } from "../components/shared/Tabs";
import { Badge } from "../components/shared/Badge";
import { ToggleButton } from "../components/shared/ToggleButton";
import { OutputBrowser, type OutputFile } from "../components/agent/OutputBrowser";
import { InputBrowser, type InputFile } from "../components/agent/InputBrowser";
import { AgentConfig } from "../components/agent/AgentConfig";
import { AgentSchedules } from "../components/agent/AgentSchedules";
import { AgentContextFiles } from "../components/agent/AgentContextFiles";
import { AgentSecrets } from "../components/agent/AgentSecrets";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { SessionSelector } from "../components/shared/SessionSelector";
import { AgentAvatar } from "../components/agent/AgentAvatar";
import { AppearanceEditor } from "../components/agent/AppearanceEditor";
import { isAdmin } from "../hooks/useAuth";
import type { AgentDetail, AgentAppearance } from "../lib/types";

type TabKey = "terminal" | "code" | "input" | "output" | "config" | "scheduler" | "context" | "secrets";

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useCachedState<TabKey>(`agent:${name}:tab`, "terminal");
  const [sequential, setSequential] = useCachedState(`agent:${name}:sequential`, false);
  const [schedulerMode, setSchedulerMode] = useCachedState(`agent:${name}:schedulerMode`, false);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [selectedSkill, setSelectedSkill] = useCachedState(`agent:${name}:skill`, "");
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
  const [appearance, setAppearance] = useState<AgentAppearance>({ color: null, emoji: null });
  const [editingAvatar, setEditingAvatar] = useState(false);
  const admin = isAdmin();

  useEffect(() => {
    if (!name || !admin) return;
    api.get<AgentAppearance>(`/agents/${name}/appearance`).then(setAppearance).catch(() => {});
  }, [name, admin]);

  const loadOutputs = useCallback(() => {
    if (!name) return;
    api.get<OutputFile[]>(`/agents/${name}/output`).then(setOutputFiles).catch(() => {});
  }, [name]);

  const loadInputs = useCallback(() => {
    if (!name) return;
    api.get<InputFile[]>(`/agents/${name}/input`).then(setInputFiles).catch(() => {});
  }, [name]);

  const loadAgent = useCallback(() => {
    if (!name) return;
    api.get<AgentDetail>(`/agents/${name}`).then((data) => {
      setAgent(data);
      setLoadError(false);
      setOutputFiles(data.outputFiles);
      setInputFiles(data.inputFiles);
    }).catch(() => setLoadError(true));
  }, [name]);

  const {
    execId, setExecId, isRunning, sessionData, loadSession,
    handleSessionChange, handleSessionRename, handleSessionDelete,
    activity, historyLimit, setHistoryLimit, sessionFilter, setSessionFilter,
    filteredQueue, filteredQuestions, submitAnswer,
    expandedExecId, toggleExpanded, addToast,
    searchQuery, handleSearchChange,
  } = useExecutionPage({
    targetType: "agent",
    targetName: name ?? "",
    cachePrefix: `agent:${name}`,
    onExecutionComplete: () => { loadOutputs(); loadAgent(); },
  });

  const [sendSystemPrompt, setSendSystemPrompt] = useState(!sessionData.sessionId);

  useEffect(() => {
    setSendSystemPrompt(!sessionData.sessionId);
  }, [sessionData.sessionId]);

  useEffect(() => {
    loadAgent();
    loadSession();
    loadOutputs();
    loadInputs();
    api.get<{ name: string; description: string }[]>("/projects/claude-skills").then(setSkills).catch(() => {});
  }, [loadAgent, loadSession, loadOutputs, loadInputs]);

  const handleStart = async (text: string, images: ImageBlock[], opts: StartOpts) => {
    if ((!text.trim() && images.length === 0) || !name) return;

    try {
      const finalPrompt = selectedSkill ? `/${selectedSkill} ${text.trim()}` : text.trim();
      const blocks = images.length > 0 ? [...images, { type: "text" as const, text: finalPrompt }] : undefined;
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "agent",
        targetName: name,
        prompt: finalPrompt,
        blocks,
        resumeSessionId: sessionData.sessionId,
        planMode: opts.planMode,
        permissionMode: opts.permissionMode,
        skipIsolationInstruction: opts.skipIsolationInstruction,
        effort: opts.effort,
        model: opts.model,
        forceQueue: sequential || undefined,
        skipSystemPrompt: !sendSystemPrompt || undefined,
        schedulerMode: schedulerMode || undefined,
      });
      if (result.queued) {
        addToast("success", `Queued (#${result.queueItem?.seqId})`);
      } else if (result.id) {
        setExecId(result.id);
      }
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed");
    }
  };

  if (!agent) {
    return loadError ? <ErrorState message="Não foi possível abrir este agente. Verifique seu acesso ou tente novamente." onRetry={() => { setLoadError(false); loadAgent(); }} /> : <LoadingState label="Carregando agente…" />;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Conversa" },
    { key: "code", label: "Código" },
    { key: "input", label: `Entradas (${inputFiles.length})` },
    { key: "output", label: `Saídas (${outputFiles.length})` },
    { key: "config", label: "Configurações" },
    { key: "scheduler", label: `Agendamentos (${agent.schedules.length})` },
    { key: "context", label: `Contexto (${agent.contextFiles.length})` },
    { key: "secrets", label: `Credenciais (${agent.secrets.length})` },
  ];

  return (
    <div className={`execution-page flex flex-col gap-4 ${tab === "terminal" ? "is-conversation" : ""} ${tab === "code" ? "h-full" : ""}`}>
      <div className="execution-page-header flex items-center gap-2 md:gap-3 flex-wrap">
        <button
          onClick={() => admin && setEditingAvatar(true)}
          disabled={!admin}
          title={admin ? "Editar avatar" : undefined}
          className={admin ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"}
        >
          <AgentAvatar name={agent.name} appearance={appearance} size={32} />
        </button>
        <h1 className="text-base md:text-lg font-semibold">{agent.name}</h1>
        {agent.schedules.length > 0 && (
          <Badge variant="info">{agent.schedules.length} schedules</Badge>
        )}
        {admin && (
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={() => {
              setDeleteConfirmName("");
              setDeleteOpen(true);
            }}
          >
            <Trash2 size={13} className="mr-1" /> Excluir
          </Button>
        )}
      </div>

      <Modal dismissible={!deleting} open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Excluir agente">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Você vai excluir permanentemente <strong className="text-text-primary">{agent.name}</strong>,
            incluindo contexto, arquivos de entrada e saída, agendamentos, credenciais,
            histórico de execuções, pedidos na fila e memória. Esta ação não pode ser desfeita.
          </p>
          <div>
            <label htmlFor="confirm-workspace-deletion" className="block text-xs text-text-muted mb-1">
              Digite <strong className="text-text-primary">{agent.name}</strong> para confirmar
            </label>
            <input
              type="text"
              id="confirm-workspace-deletion"
              disabled={deleting}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={agent.name}
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleteConfirmName !== agent.name || deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await api.delete(`/agents/${agent.name}`);
                  addToast("success", `Agent "${agent.name}" deleted`);
                  window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
                  navigate("/workspaces/agents");
                } catch (err) {
                  addToast("error", err instanceof Error ? err.message : "Delete failed");
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Excluindo…" : "Excluir agente"}
            </Button>
          </div>
        </div>
      </Modal>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "terminal" && (
        <ConversationWorkspace questions={filteredQuestions} onAnswer={submitAnswer} history={
          <ExecutionActivity
            activity={activity}
            filteredQueue={filteredQueue}
            expandedExecId={expandedExecId}
            toggleExpanded={toggleExpanded}
            sessionData={sessionData}
            sessionFilter={sessionFilter}
            setSessionFilter={setSessionFilter}
            historyLimit={historyLimit}
            setHistoryLimit={setHistoryLimit}
            searchQuery={searchQuery}
            handleSearchChange={handleSearchChange}
          />
        }>
            <Terminal
              key={name}
              executionId={execId}
              base={`agent:${name}`}
              startPlaceholder={`Message ${name}...`}
              queueMode={sequential}
              isLive={isRunning}
              onStart={handleStart}
              inputControls={
                <>
                  <SessionSelector
                    sessionData={sessionData}
                    onChange={handleSessionChange}
                    onRename={handleSessionRename}
                    onDelete={handleSessionDelete}
                    disabled={!sequential && isRunning}
                    disabledTitle="Com o Queue desligado, novas mensagens entram na execução atual — troque o Queue para mudar de sessão"
                  />
                  <ToggleButton
                    active={sequential}
                    onToggle={() => setSequential(!sequential)}
                    icon={ListOrdered}
                    label="Fila"
                    title={sequential ? "Sequential mode ON (commands queue in order)" : "Sequential mode OFF (parallel execution)"}
                  />
                </>
              }
              controls={
                <>
                  <ToggleButton
                    active={sendSystemPrompt}
                    onToggle={() => setSendSystemPrompt(!sendSystemPrompt)}
                    icon={FileText}
                    label="System"
                    title={sendSystemPrompt ? "System prompt will be sent (click to skip)" : "System prompt will NOT be sent (click to include)"}
                  />
                  <ToggleButton
                    active={schedulerMode}
                    onToggle={() => setSchedulerMode(!schedulerMode)}
                    icon={CalendarClock}
                    label="Scheduler"
                    title={schedulerMode ? "Modo Scheduler ON: peça uma tarefa recorrente e o agente vai agendá-la (aba Scheduler)" : "Modo Scheduler OFF (clique para deixar o agente criar agendamentos)"}
                  />
                  {skills.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Zap size={13} className={selectedSkill ? "text-accent" : "text-text-muted"} />
                      <select
                        aria-label="Habilidade"
                        value={selectedSkill}
                        onChange={(e) => setSelectedSkill(e.target.value)}
                        title={selectedSkill ? skills.find((s) => s.name === selectedSkill)?.description : ""}
                        className={`text-xs bg-transparent border rounded-md px-1 py-1 focus:outline-none focus:border-accent ${
                          selectedSkill
                            ? "border-accent/40 text-accent"
                            : "border-border text-text-muted"
                        }`}
                      >
                        <option value="">Nenhuma habilidade</option>
                        {skills.map((s) => (
                          <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              }
            />
        </ConversationWorkspace>
      )}

      {tab === "code" && name && (
        <div className="flex-1 min-h-0">
          <FilesBrowser base={`agent:${name}`} />
        </div>
      )}

      {tab === "input" && (
        <InputBrowser apiBasePath={`/agents/${agent.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {tab === "output" && (
        <OutputBrowser apiBasePath={`/agents/${agent.name}`} files={outputFiles} onRefresh={loadOutputs} />
      )}

      {tab === "config" && (
        <AgentConfig
          agentName={agent.name}
          agentsMd={agent.agentsMd}
        />
      )}

      {tab === "scheduler" && (
        <AgentSchedules
          agentName={agent.name}
          schedules={agent.schedules}
          onRefresh={loadAgent}
        />
      )}

      {tab === "context" && (
        <AgentContextFiles
          agentName={agent.name}
          contextFiles={agent.contextFiles}
          onRefresh={loadAgent}
        />
      )}

      {tab === "secrets" && (
        <AgentSecrets
          agentName={agent.name}
          secrets={agent.secrets}
          secretFiles={agent.secretFiles}
          onRefresh={loadAgent}
        />
      )}

      {editingAvatar && (
        <AppearanceEditor agentName={agent.name} open onClose={() => setEditingAvatar(false)} onSaved={setAppearance} />
      )}
    </div>
  );
}
