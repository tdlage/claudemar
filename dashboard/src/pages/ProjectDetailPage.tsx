import { createPortal } from "react-dom";
import type { LayoutOutletContext } from "../components/layout/Layout";
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { Bot, ListOrdered, Zap, Trash2 } from "lucide-react";
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
import { FilesBrowser } from "../components/project/FilesBrowser";
import { RepositoriesTab } from "../components/project/RepositoriesTab";
import { CITab } from "../components/project/CITab";
import { PipelineBoard } from "../components/pipeline/PipelineBoard";
import { InputBrowser, type InputFile } from "../components/agent/InputBrowser";
import { OutputBrowser, type OutputFile } from "../components/agent/OutputBrowser";
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { SessionSelector } from "../components/shared/SessionSelector";
import { isAdmin, projectTabsFor, refreshMe } from "../hooks/useAuth";
import { type ProjectDetail, type ProjectTabKey } from "../lib/types";

type TabKey = ProjectTabKey;

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { projectActions } = useOutletContext<LayoutOutletContext>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useCachedState<TabKey>(`project:${name}:tab`, "terminal");
  const [sequential, setSequential] = useCachedState(`project:${name}:sequential`, true);
  const [selectedAgent, setSelectedAgent] = useCachedState(`project:${name}:agent`, "");
  const [agents, setAgents] = useState<string[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [selectedSkill, setSelectedSkill] = useCachedState(`project:${name}:skill`, "");
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [ciInitialRepo, setCiInitialRepo] = useState<string | undefined>();
  const [, setMeVersion] = useState(0);
  const admin = isAdmin();
  const enabledTabs = name ? projectTabsFor(name) : "all";
  const tabEnabled = (key: TabKey) => enabledTabs === "all" || enabledTabs.includes(key);

  useEffect(() => {
    if (admin) return;
    refreshMe().then((me) => { if (me) setMeVersion((v) => v + 1); });
  }, [admin]);

  const loadProject = useCallback(() => {
    if (!name) return;
    api.get<ProjectDetail>(`/projects/${name}`).then((data) => {
      setProject(data);
      setLoadError(false);
      setInputFiles(data.inputFiles ?? []);
    }).catch(() => setLoadError(true));
  }, [name]);

  const loadInputs = useCallback(() => {
    if (!name) return;
    api.get<InputFile[]>(`/projects/${name}/input`).then(setInputFiles).catch(() => {});
  }, [name]);

  const loadOutputs = useCallback(() => {
    if (!name) return;
    api.get<OutputFile[]>(`/projects/${name}/output`).then(setOutputFiles).catch(() => {});
  }, [name]);

  const {
    execId, setExecId, isRunning, sessionData, loadSession,
    handleSessionChange, handleSessionRename, handleSessionDelete,
    activity, historyLimit, setHistoryLimit, sessionFilter, setSessionFilter,
    filteredQueue, filteredQuestions, submitAnswer,
    expandedExecId, toggleExpanded, addToast,
    searchQuery, handleSearchChange,
  } = useExecutionPage({
    targetType: "project",
    targetName: name ?? "",
    cachePrefix: `project:${name}`,
    onExecutionComplete: () => { loadProject(); loadOutputs(); },
  });

  useEffect(() => {
    loadProject();
    loadOutputs();
    api.get<string[]>(`/projects/${name}/claude-agents`).then(setAgents).catch(() => {});
    api.get<{ name: string; description: string }[]>("/projects/claude-skills").then(setSkills).catch(() => {});
  }, [loadProject, loadOutputs, name]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const handleStart = async (text: string, images: ImageBlock[], opts: StartOpts) => {
    if ((!text.trim() && images.length === 0) || !name) return;

    try {
      const finalPrompt = selectedSkill ? `/${selectedSkill} ${text.trim()}` : text.trim();
      const blocks = images.length > 0 ? [...images, { type: "text" as const, text: finalPrompt }] : undefined;
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "project",
        targetName: name,
        prompt: finalPrompt,
        blocks,
        resumeSessionId: sessionData.sessionId,
        planMode: opts.planMode,
        permissionMode: opts.permissionMode,
        skipIsolationInstruction: opts.skipIsolationInstruction,
        effort: opts.effort,
        agentName: selectedAgent || undefined,
        forceQueue: sequential || undefined,
        model: opts.model,
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

  if (!project) {
    return loadError ? <ErrorState message="Não foi possível abrir este projeto. Verifique seu acesso ou tente novamente." onRetry={() => { setLoadError(false); loadProject(); }} /> : <LoadingState label="Carregando projeto…" />;
  }

  const changedRepoCount = project.repos.filter((r) => r.hasChanges).length;
  const hasGithubRepos = project.repos.some((r) => r.remoteUrl.includes("github.com"));

  const tabs: { key: TabKey; label: string; badge?: number; badgeVariant?: "warning" }[] = [
    ...(tabEnabled("terminal") ? [{ key: "terminal" as const, label: "Conversa" }] : []),
    ...(tabEnabled("input") ? [{ key: "input" as const, label: `Entradas (${inputFiles.length})` }] : []),
    ...(tabEnabled("output") ? [{ key: "output" as const, label: `Saídas (${outputFiles.length})` }] : []),
    ...(tabEnabled("repositories") ? [{ key: "repositories" as const, label: "Repositórios", ...(changedRepoCount > 0 && { badge: changedRepoCount, badgeVariant: "warning" as const }) }] : []),
    ...(tabEnabled("files") ? [{ key: "files" as const, label: "Código" }] : []),
    ...(tabEnabled("ci") && hasGithubRepos ? [{ key: "ci" as const, label: "CI" }] : []),
    ...(tabEnabled("pipeline") && project.repos.length > 0 ? [{ key: "pipeline" as const, label: "Pipeline" }] : []),
  ];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "terminal");

  return (
    <div className={`execution-page project-detail-page flex flex-col gap-4 ${activeTab === "terminal" ? "is-conversation" : ""} ${activeTab === "files" ? "h-full" : ""}`}>
      {projectActions && createPortal(<>
        <span className="project-repo-count"><Badge variant="default">{project.repos.length} repos</Badge></span>
        {admin && (
          <Button
            size="sm"
            variant="danger"
            className="project-delete-button"
            aria-label="Excluir projeto"
            title="Excluir projeto"
            onClick={() => {
              setDeleteConfirmName("");
              setDeleteOpen(true);
            }}
          >
            <Trash2 size={14} /> <span className="hidden md:inline">Excluir</span>
          </Button>
        )}
      </>, projectActions)}

      <Modal dismissible={!deleting} open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Excluir projeto">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Você vai excluir permanentemente <strong className="text-text-primary">{project.name}</strong>,
            incluindo arquivos e repositórios, worktrees, pipeline e agendamentos, configurações,
            histórico de execuções, pedidos na fila e memória. Esta ação não pode ser desfeita.
          </p>
          <div>
            <label htmlFor="confirm-workspace-deletion" className="block text-xs text-text-muted mb-1">
              Digite <strong className="text-text-primary">{project.name}</strong> para confirmar
            </label>
            <input
              type="text"
              id="confirm-workspace-deletion"
              disabled={deleting}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={project.name}
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
              disabled={deleteConfirmName !== project.name || deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await api.delete(`/projects/${project.name}`);
                  addToast("success", `Project "${project.name}" deleted`);
                  window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
                  navigate("/workspaces/projects");
                } catch (err) {
                  addToast("error", err instanceof Error ? err.message : "Delete failed");
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Excluindo…" : "Excluir projeto"}
            </Button>
          </div>
        </div>
      </Modal>

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} />

      {activeTab === "terminal" && (
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
              base={`project:${name}`}
              startPlaceholder={`Message ${name}...`}
              queueMode={sequential}
              isLive={isRunning}
              onStart={handleStart}
              configurationSummary={[selectedAgent && `Agente: ${selectedAgent}`, selectedSkill && `Habilidade: ${selectedSkill}`].filter(Boolean).join(" · ")}
              controls={
                <>
                  <div className="flex items-center gap-1">
                    <span className="inline-flex items-center gap-1.5 text-text-secondary"><Bot size={13} />Agente</span>
                    <select
                      aria-label="Agente"
                      value={selectedAgent}
                      onChange={(e) => setSelectedAgent(e.target.value)}
                      className={`text-xs bg-transparent border rounded-md px-1 py-1 focus:outline-none focus:border-accent ${
                        selectedAgent
                          ? "border-accent/40 text-accent"
                          : "border-border text-text-muted"
                      }`}
                    >
                      <option value="">Sem agente adicional</option>
                      {agents.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  {skills.length > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="inline-flex items-center gap-1.5 text-text-secondary"><Zap size={13} />Habilidade</span>
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
            />
        </ConversationWorkspace>
      )}

      {activeTab === "input" && (
        <InputBrowser apiBasePath={`/projects/${project.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {activeTab === "output" && (
        <OutputBrowser apiBasePath={`/projects/${project.name}`} files={outputFiles} onRefresh={loadOutputs} />
      )}

      {activeTab === "repositories" && (
        <RepositoriesTab
          projectName={project.name}
          repos={project.repos}
          onRefresh={loadProject}
          onNavigateCI={(repoName) => {
            setCiInitialRepo(repoName);
            setTab("ci");
          }}
        />
      )}

      {activeTab === "files" && name && (
        <div className="flex-1 min-h-0">
          <FilesBrowser projectName={name} />
        </div>
      )}

      {activeTab === "ci" && (
        <CITab projectName={project.name} repos={project.repos.filter((repo) => !repo.hidden)} initialRepo={ciInitialRepo} />
      )}

      {activeTab === "pipeline" && (
        <PipelineBoard projectName={project.name} />
      )}
    </div>
  );
}
