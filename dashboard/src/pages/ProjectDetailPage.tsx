import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Square, Map, Bot, ListOrdered, Cpu, Container, Zap } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { RepositoriesTab } from "../components/project/RepositoriesTab";
import { InputBrowser, type InputFile } from "../components/agent/InputBrowser";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { VoiceInput } from "../components/shared/VoiceInput";
import { SessionSelector } from "../components/shared/SessionSelector";
import { isAdmin } from "../hooks/useAuth";
import type { ProjectDetail } from "../lib/types";

type TabKey = "terminal" | "repositories" | "files" | "input";

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useCachedState<TabKey>(`project:${name}:tab`, "terminal");
  const [prompt, setPrompt] = useCachedState(`project:${name}:prompt`, "");
  const [planMode, setPlanMode] = useCachedState(`project:${name}:planMode`, false);
  const [sequential, setSequential] = useCachedState(`project:${name}:sequential`, true);
  const [dockerMode, setDockerMode] = useCachedState(`project:${name}:dockerMode`, false);
  const [selectedModel, setSelectedModel] = useCachedState(`project:${name}:model`, "claude-opus-4-6");
  const [selectedAgent, setSelectedAgent] = useCachedState(`project:${name}:agent`, "");
  const [agents, setAgents] = useState<string[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [selectedSkill, setSelectedSkill] = useCachedState(`project:${name}:skill`, "");
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);
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
    handleSessionChange, handleSessionRename,
    activity, filteredQueue, filteredQuestions, submitAnswer,
    expandedExecId, toggleExpanded, addToast,
  } = useExecutionPage({
    targetType: "project",
    targetName: name ?? "",
    cachePrefix: `project:${name}`,
    onExecutionComplete: loadProject,
  });

  useEffect(() => {
    loadProject();
    loadSession();
    api.get<string[]>(`/projects/${name}/claude-agents`).then(setAgents).catch(() => {});
    api.get<{ name: string; description: string }[]>("/projects/claude-skills").then(setSkills).catch(() => {});
    api.get<{ model: string | null }>(`/executions/model-preference/project/${name}`)
      .then((data) => { if (data.model) setSelectedModel(data.model); })
      .catch(() => {});
  }, [loadProject, loadSession]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !name) return;

    try {
      const finalPrompt = selectedSkill ? `/${selectedSkill} ${prompt.trim()}` : prompt.trim();
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "project",
        targetName: name,
        prompt: finalPrompt,
        planMode,
        agentName: selectedAgent || undefined,
        forceQueue: sequential || undefined,
        model: selectedModel || undefined,
        useDocker: admin ? dockerMode : true,
      });
      if (result.queued) {
        addToast("success", `Queued (#${result.queueItem?.seqId})`);
      } else if (result.id) {
        setExecId(result.id);
        addToast("success", "Execution started");
      }
      setPrompt("");
      setPlanMode(false);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed");
    }
  };

  if (!project) {
    return <p className="text-text-muted">Loading...</p>;
  }

  const changedRepoCount = project.repos.filter((r) => r.hasChanges).length;

  const tabs: { key: TabKey; label: string; badge?: number; badgeVariant?: "warning" }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "input" as const, label: `Input (${inputFiles.length})` },
    ...(admin ? [
      { key: "repositories" as const, label: "Repositories", ...(changedRepoCount > 0 && { badge: changedRepoCount, badgeVariant: "warning" as const }) },
      { key: "files" as const, label: "Code" },
    ] : []),
  ];

  return (
    <div className={`flex flex-col gap-4 ${tab === "files" ? "h-full" : ""}`}>
      <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap">
        <h1 className="text-base md:text-lg font-semibold">{project.name}</h1>
        <Badge variant="default">{project.repos.length} repos</Badge>
        <SessionSelector
          sessionData={sessionData}
          onChange={handleSessionChange}
          onRename={handleSessionRename}
        />
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
          <form onSubmit={handleExecute} className="space-y-2">
            <div className="flex gap-2 items-end">
              <VoiceInput onTranscription={(text) => setPrompt((prev) => prev ? `${prev} ${text}` : text)} />
              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim()) handleExecute(e);
                  }
                }}
                placeholder={`Message ${name}...`}
                rows={1}
                className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none overflow-y-auto"
                style={{ maxHeight: 200 }}
              />
              <Button type="submit" disabled={!prompt.trim()}>Send</Button>
              {isRunning && (
                <Button
                  variant="danger"
                  onClick={() => {
                    if (execId) api.post(`/executions/${execId}/stop`).catch(() => {});
                  }}
                >
                  <Square size={14} />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Bot size={13} className={selectedAgent ? "text-accent" : "text-text-muted"} />
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className={`text-xs bg-transparent border rounded-md px-1 py-1.5 focus:outline-none focus:border-accent ${
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
                    className={`text-xs bg-transparent border rounded-md px-1 py-1.5 focus:outline-none focus:border-accent ${
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
              <button
                type="button"
                onClick={() => setPlanMode(!planMode)}
                title={planMode ? "Plan mode ON (read-only)" : "Plan mode OFF"}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all select-none whitespace-nowrap ${
                  planMode
                    ? "bg-accent/20 text-accent border border-accent/40 shadow-[0_0_6px_rgba(var(--accent-rgb),0.15)]"
                    : "text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent"
                }`}
              >
                <Map size={13} />
                Plan
              </button>
              <button
                type="button"
                onClick={() => setSequential(!sequential)}
                title={sequential ? "Sequential mode ON (commands queue in order)" : "Sequential mode OFF (parallel execution)"}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all select-none whitespace-nowrap ${
                  sequential
                    ? "bg-accent/20 text-accent border border-accent/40 shadow-[0_0_6px_rgba(var(--accent-rgb),0.15)]"
                    : "text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent"
                }`}
              >
                <ListOrdered size={13} />
                Queue
              </button>
              {admin && (
                <button
                  type="button"
                  onClick={() => setDockerMode(!dockerMode)}
                  title={dockerMode ? "Docker mode ON (runs in container)" : "Docker mode OFF (runs natively)"}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all select-none whitespace-nowrap ${
                    dockerMode
                      ? "bg-accent/20 text-accent border border-accent/40 shadow-[0_0_6px_rgba(var(--accent-rgb),0.15)]"
                      : "text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent"
                  }`}
                >
                  <Container size={13} />
                  Docker
                </button>
              )}
              <div className="flex items-center gap-1">
                <Cpu size={13} className="text-text-muted" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="text-xs bg-transparent border border-border rounded-md px-1 py-1.5 text-text-muted focus:outline-none focus:border-accent"
                >
                  <option value="claude-opus-4-6">Opus 4.6</option>
                  <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                  <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                </select>
              </div>
            </div>
          </form>
          <div className="h-[300px] md:h-[500px]">
            <Terminal key={name} executionId={execId} />
          </div>

          {(activity.length > 0 || filteredQueue.length > 0) && (
            <div>
              <h2 className="text-sm font-medium text-text-muted mb-2">Activity</h2>
              <ActivityFeed
                executions={activity}
                queue={filteredQueue}
                expandedId={expandedExecId}
                onToggle={toggleExpanded}
                sessionNames={sessionData.names}
              />
            </div>
          )}
        </div>
      )}

      {tab === "input" && (
        <InputBrowser apiBasePath={`/projects/${project.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {tab === "repositories" && (
        <RepositoriesTab
          projectName={project.name}
          repos={project.repos}
          onRefresh={loadProject}
        />
      )}

      {tab === "files" && name && (
        <div className="flex-1 min-h-0">
          <FilesBrowser projectName={name} />
        </div>
      )}
    </div>
  );
}
