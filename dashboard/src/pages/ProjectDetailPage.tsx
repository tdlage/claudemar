import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Square, Map, Bot, ListOrdered } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { RepositoriesTab } from "../components/project/RepositoriesTab";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { useExecutions } from "../hooks/useExecution";
import { useToast } from "../components/shared/Toast";
import { useCachedState } from "../hooks/useCachedState";
import { VoiceInput } from "../components/shared/VoiceInput";
import type { ProjectDetail } from "../lib/types";

type TabKey = "terminal" | "repositories" | "files";

interface SessionData {
  sessionId: string | null;
  history: string[];
}

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { addToast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useCachedState<TabKey>(`project:${name}:tab`, "terminal");
  const [prompt, setPrompt] = useCachedState(`project:${name}:prompt`, "");
  const [planMode, setPlanMode] = useCachedState(`project:${name}:planMode`, false);
  const [execId, setExecId] = useCachedState<string | null>(`project:${name}:execId`, null);
  const [expandedExecId, setExpandedExecId] = useCachedState<string | null>(`project:${name}:expandedExecId`, null);
  const [sequential, setSequential] = useCachedState(`project:${name}:sequential`, true);
  const [selectedAgent, setSelectedAgent] = useCachedState(`project:${name}:agent`, "");
  const [agents, setAgents] = useState<string[]>([]);
  const [sessionData, setSessionData] = useState<SessionData>({ sessionId: null, history: [] });
  const { active, recent, queue, pendingQuestions, submitAnswer } = useExecutions();

  const projectActive = active.filter((e) => e.targetName === name);
  const projectRecent = recent.filter((e) => e.targetName === name);
  const projectActivity = [...projectActive, ...projectRecent];
  const projectQueue = queue.filter((q) => q.targetName === name);
  const activeExec = execId ? active.find((e) => e.id === execId) : undefined;
  const isRunning = !!activeExec;

  const loadProject = useCallback(() => {
    if (!name) return;
    api.get<ProjectDetail>(`/projects/${name}`).then(setProject).catch(() => {});
  }, [name]);

  const loadSession = useCallback(() => {
    if (!name) return;
    api.get<SessionData>(`/executions/session/project/${name}`)
      .then(setSessionData)
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    loadProject();
    loadSession();
    api.get<string[]>(`/projects/${name}/claude-agents`).then(setAgents).catch(() => {});
  }, [loadProject, loadSession]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === "project" && e.targetName === name);
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      loadSession();
      loadProject();
    }
  }, [name, active, execId, loadSession, loadProject]);

  const handleSessionChange = async (value: string) => {
    if (!name) return;
    if (value === "__new") {
      try {
        await api.delete(`/executions/session/project/${name}`);
        setSessionData((prev) => ({ ...prev, sessionId: null }));
        addToast("success", "New session");
      } catch {
        addToast("error", "Failed to reset session");
      }
    } else {
      try {
        await api.put(`/executions/session/project/${name}`, { sessionId: value });
        setSessionData((prev) => ({ ...prev, sessionId: value }));
        addToast("success", `Session switched to ${value.slice(0, 8)}`);
      } catch {
        addToast("error", "Failed to switch session");
      }
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !name) return;

    try {
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "project",
        targetName: name,
        prompt: prompt.trim(),
        planMode,
        agentName: selectedAgent || undefined,
        forceQueue: sequential || undefined,
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

  const toggleExpanded = (id: string) => {
    setExpandedExecId((prev) => (prev === id ? null : id));
  };

  if (!project) {
    return <p className="text-text-muted">Loading...</p>;
  }

  const changedRepoCount = project.repos.filter((r) => r.hasChanges).length;

  const tabs: { key: TabKey; label: string; badge?: number; badgeVariant?: "warning" }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "repositories", label: "Repositories", ...(changedRepoCount > 0 && { badge: changedRepoCount, badgeVariant: "warning" as const }) },
    { key: "files", label: "Code" },
  ];

  return (
    <div className={`flex flex-col gap-4 ${tab === "files" ? "h-full" : ""}`}>
      <div className="flex items-center gap-2 md:gap-3 shrink-0 flex-wrap">
        <h1 className="text-base md:text-lg font-semibold">{project.name}</h1>
        <Badge variant="default">{project.repos.length} repos</Badge>
        <select
          value={sessionData.sessionId ?? "__new"}
          onChange={(e) => handleSessionChange(e.target.value)}
          className="text-xs font-mono bg-surface border border-border rounded-md px-2 py-1 text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="__new">New session</option>
          {sessionData.history.map((sid) => (
            <option key={sid} value={sid}>
              {sid.slice(0, 8)}{sid === sessionData.sessionId ? " (active)" : ""}
            </option>
          ))}
        </select>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "terminal" && (
        <div className="space-y-3">
          {pendingQuestions
            .filter((pq) => pq.info.targetType === "project" && pq.info.targetName === name)
            .map((pq) => (
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
            </div>
          </form>
          <div className="h-[300px] md:h-[500px]">
            <Terminal key={name} executionId={execId} />
          </div>

          {(projectActivity.length > 0 || projectQueue.length > 0) && (
            <div>
              <h2 className="text-sm font-medium text-text-muted mb-2">Activity</h2>
              <ActivityFeed
                executions={projectActivity}
                queue={projectQueue}
                expandedId={expandedExecId}
                onToggle={toggleExpanded}
              />
            </div>
          )}
        </div>
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
