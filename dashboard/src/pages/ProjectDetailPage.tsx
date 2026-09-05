import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Bot, ListOrdered, Zap, Cpu, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { Modal } from "../components/shared/Modal";
import { Button } from "../components/shared/Button";
import { Terminal, type StartOpts } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
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
import { DEFAULT_PROJECT_MODEL, type ProjectDetail, type ProjectTabKey, type ProviderInfo } from "../lib/types";

type TabKey = ProjectTabKey;

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
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
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [projectModel, setProjectModel] = useState<string>(DEFAULT_PROJECT_MODEL);
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
      setInputFiles(data.inputFiles ?? []);
      setProjectModel(data.model ?? DEFAULT_PROJECT_MODEL);
    }).catch(() => {});
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
    api.get<ProviderInfo>("/system/provider").then(setProviderInfo).catch(() => {});
  }, [loadProject, loadOutputs, name]);

  const handleModelChange = async (model: string) => {
    if (!name) return;
    const previous = projectModel;
    setProjectModel(model);
    try {
      await api.put(`/projects/${name}/model`, { model });
    } catch (err) {
      setProjectModel(previous);
      addToast("error", err instanceof Error ? err.message : "Failed to update model");
    }
  };

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
        effort: opts.effort,
        agentName: selectedAgent || undefined,
        forceQueue: sequential || undefined,
        model: providerInfo?.selectableModels.some((item) => item.model === projectModel) ? projectModel : providerInfo?.defaultModel,
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
    return <p className="text-text-muted">Loading...</p>;
  }

  const changedRepoCount = project.repos.filter((r) => r.hasChanges).length;
  const hasGithubRepos = project.repos.some((r) => r.remoteUrl.includes("github.com"));
  const selectableModels = providerInfo?.selectableModels ?? [];
  const selectedModel = selectableModels.some((item) => item.model === projectModel)
    ? projectModel
    : (providerInfo?.defaultModel ?? projectModel);

  const tabs: { key: TabKey; label: string; badge?: number; badgeVariant?: "warning" }[] = [
    ...(tabEnabled("terminal") ? [{ key: "terminal" as const, label: "Terminal" }] : []),
    ...(tabEnabled("input") ? [{ key: "input" as const, label: `Input (${inputFiles.length})` }] : []),
    ...(tabEnabled("output") ? [{ key: "output" as const, label: `Output (${outputFiles.length})` }] : []),
    ...(tabEnabled("repositories") ? [{ key: "repositories" as const, label: "Repositories", ...(changedRepoCount > 0 && { badge: changedRepoCount, badgeVariant: "warning" as const }) }] : []),
    ...(tabEnabled("files") ? [{ key: "files" as const, label: "Code" }] : []),
    ...(tabEnabled("ci") && hasGithubRepos ? [{ key: "ci" as const, label: "CI" }] : []),
    ...(tabEnabled("pipeline") && project.repos.length > 0 ? [{ key: "pipeline" as const, label: "Pipeline" }] : []),
  ];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "terminal");

  return (
    <div className={`flex flex-col gap-4 ${activeTab === "files" ? "h-full" : ""}`}>
      <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap">
        <h1 className="text-base md:text-lg font-semibold">{project.name}</h1>
        <Badge variant="default">{project.repos.length} repos</Badge>
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
            <Trash2 size={13} className="mr-1" /> Delete
          </Button>
        )}
      </div>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Project">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            This will permanently delete <strong className="text-text-primary">{project.name}</strong> and
            everything related to it: the project folder with all repositories and files, worktrees,
            pipeline (cards, runs, intake crons), run configs, execution history, queued commands and
            long-term memory. This cannot be undone.
          </p>
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Type <strong className="text-text-primary">{project.name}</strong> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={project.name}
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
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
                  navigate("/");
                } catch (err) {
                  addToast("error", err instanceof Error ? err.message : "Delete failed");
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Deleting..." : "Delete Project"}
            </Button>
          </div>
        </div>
      </Modal>

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} />

      {activeTab === "terminal" && (
        <div className="space-y-3">
          {filteredQuestions.map((pq) => (
            <QuestionPanel
              key={pq.execId}
              execId={pq.execId}
              question={pq.question}
              targetName={name!}
              onSubmit={submitAnswer}
              onDismiss={(id) => {
                api.post(`/executions/${id}/stop`).catch(() => {});
              }}
            />
          ))}
          <div className="h-[300px] md:h-[500px]">
            <Terminal
              key={name}
              executionId={execId}
              base={`project:${name}`}
              startPlaceholder={`Message ${name}...`}
              queueMode={sequential}
              isLive={isRunning}
              runtime={providerInfo?.runtime}
              showModelBadge={selectableModels.length === 0}
              onStart={handleStart}
              controls={
                <>
                  {selectableModels.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Cpu size={13} className={selectedModel !== providerInfo?.defaultModel ? "text-accent" : "text-text-muted"} />
                      <select
                        value={selectedModel}
                        onChange={(e) => handleModelChange(e.target.value)}
                        title="Modelo usado nas execuções deste projeto"
                        className={`text-xs bg-transparent border rounded-md px-1 py-1 focus:outline-none focus:border-accent ${
                          selectedModel !== providerInfo?.defaultModel
                            ? "border-accent/40 text-accent"
                            : "border-border text-text-muted"
                        }`}
                      >
                        {selectableModels.map((m) => (
                          <option key={m.model} value={m.model}>{m.displayName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Bot size={13} className={selectedAgent ? "text-accent" : "text-text-muted"} />
                    <select
                      value={selectedAgent}
                      onChange={(e) => setSelectedAgent(e.target.value)}
                      className={`text-xs bg-transparent border rounded-md px-1 py-1 focus:outline-none focus:border-accent ${
                        selectedAgent
                          ? "border-accent/40 text-accent"
                          : "border-border text-text-muted"
                      }`}
                    >
                      <option value="">No agent</option>
                      {agents.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  {skills.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Zap size={13} className={selectedSkill ? "text-accent" : "text-text-muted"} />
                      <select
                        value={selectedSkill}
                        onChange={(e) => setSelectedSkill(e.target.value)}
                        title={selectedSkill ? skills.find((s) => s.name === selectedSkill)?.description : ""}
                        className={`text-xs bg-transparent border rounded-md px-1 py-1 focus:outline-none focus:border-accent ${
                          selectedSkill
                            ? "border-accent/40 text-accent"
                            : "border-border text-text-muted"
                        }`}
                      >
                        <option value="">No skill</option>
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
                    label="Queue"
                    title={sequential ? "Sequential mode ON (commands queue in order)" : "Sequential mode OFF (parallel execution)"}
                  />
                </>
              }
            />
          </div>

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
        </div>
      )}

      {activeTab === "input" && (
        <InputBrowser apiBasePath={`/projects/${project.name}`} base={`project:${project.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {activeTab === "output" && (
        <OutputBrowser apiBasePath={`/projects/${project.name}`} base={`project:${project.name}`} outputDir=".output" files={outputFiles} onRefresh={loadOutputs} />
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
        <CITab projectName={project.name} repos={project.repos} initialRepo={ciInitialRepo} />
      )}

      {activeTab === "pipeline" && (
        <PipelineBoard projectName={project.name} />
      )}
    </div>
  );
}
