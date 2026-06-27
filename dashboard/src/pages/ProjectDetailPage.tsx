import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Bot, ListOrdered, Zap } from "lucide-react";
import { api } from "../lib/api";
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
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { SessionSelector } from "../components/shared/SessionSelector";
import { isAdmin } from "../hooks/useAuth";
import type { ProjectDetail } from "../lib/types";

type TabKey = "terminal" | "repositories" | "files" | "input" | "ci" | "pipeline";

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useCachedState<TabKey>(`project:${name}:tab`, "terminal");
  const [sequential, setSequential] = useCachedState(`project:${name}:sequential`, true);
  const [selectedAgent, setSelectedAgent] = useCachedState(`project:${name}:agent`, "");
  const [agents, setAgents] = useState<string[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [selectedSkill, setSelectedSkill] = useCachedState(`project:${name}:skill`, "");
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
  const [ciInitialRepo, setCiInitialRepo] = useState<string | undefined>();
  const admin = isAdmin();

  const loadProject = useCallback(() => {
    if (!name) return;
    api.get<ProjectDetail>(`/projects/${name}`).then((data) => {
      setProject(data);
      setInputFiles(data.inputFiles ?? []);
    }).catch(() => {});
  }, [name]);

  const loadInputs = useCallback(() => {
    if (!name) return;
    api.get<InputFile[]>(`/projects/${name}/input`).then(setInputFiles).catch(() => {});
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
    onExecutionComplete: loadProject,
  });

  useEffect(() => {
    loadProject();
    api.get<string[]>(`/projects/${name}/claude-agents`).then(setAgents).catch(() => {});
    api.get<{ name: string; description: string }[]>("/projects/claude-skills").then(setSkills).catch(() => {});
  }, [loadProject, name]);

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

  const tabs: { key: TabKey; label: string; badge?: number; badgeVariant?: "warning" }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "input" as const, label: `Input (${inputFiles.length})` },
    ...(admin ? [
      { key: "repositories" as const, label: "Repositories", ...(changedRepoCount > 0 && { badge: changedRepoCount, badgeVariant: "warning" as const }) },
      { key: "files" as const, label: "Code" },
      ...(hasGithubRepos ? [{ key: "ci" as const, label: "CI" }] : []),
      ...(project.repos.length > 0 ? [{ key: "pipeline" as const, label: "Pipeline" }] : []),
    ] : []),
  ];

  return (
    <div className={`flex flex-col gap-4 ${tab === "files" ? "h-full" : ""}`}>
      <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap">
        <h1 className="text-base md:text-lg font-semibold">{project.name}</h1>
        <Badge variant="default">{project.repos.length} repos</Badge>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "terminal" && (
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
              onStart={handleStart}
              controls={
                <>
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

      {tab === "input" && (
        <InputBrowser apiBasePath={`/projects/${project.name}`} base={`project:${project.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {tab === "repositories" && (
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

      {tab === "files" && name && (
        <div className="flex-1 min-h-0">
          <FilesBrowser projectName={name} />
        </div>
      )}

      {tab === "ci" && (
        <CITab projectName={project.name} repos={project.repos} initialRepo={ciInitialRepo} />
      )}

      {tab === "pipeline" && (
        <PipelineBoard projectName={project.name} />
      )}
    </div>
  );
}
