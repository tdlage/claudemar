import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { RotateCcw, Square } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { RepositoriesTab } from "../components/project/RepositoriesTab";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { useExecutions } from "../hooks/useExecution";
import { useToast } from "../components/shared/Toast";
import type { ProjectDetail } from "../lib/types";

type TabKey = "terminal" | "repositories" | "files";

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { addToast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("terminal");
  const [prompt, setPrompt] = useState("");
  const [execId, setExecId] = useState<string | null>(null);
  const [expandedExecId, setExpandedExecId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { active, recent, queue } = useExecutions();

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
    api.get<{ sessionId: string | null }>(`/executions/session/project/${name}`)
      .then((data) => setSessionId(data.sessionId))
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    loadProject();
    loadSession();
    setExpandedExecId(null);
  }, [loadProject, loadSession]);

  useEffect(() => {
    setExecId(null);
  }, [name]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === "project" && e.targetName === name);
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      setExecId(null);
      loadSession();
    }
  }, [name, active]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !name) return;

    try {
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "project",
        targetName: name,
        prompt: prompt.trim(),
      });
      if (result.queued) {
        addToast("success", `Queued (#${result.queueItem?.seqId})`);
      } else if (result.id) {
        setExecId(result.id);
        addToast("success", "Execution started");
      }
      setPrompt("");
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "repositories", label: "Repositories" },
    { key: "files", label: "Files" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{project.name}</h1>
        <Badge variant="default">{project.repos.length} repos</Badge>
        {sessionId && (
          <span className="text-xs text-text-muted font-mono bg-surface px-2 py-0.5 rounded border border-border">
            session: {sessionId.slice(0, 8)}
          </span>
        )}
        <button
          onClick={() => {
            api.delete(`/executions/session/project/${name}`).then(() => {
              setSessionId(null);
              addToast("success", "Session reset");
            }).catch(() => addToast("error", "Failed to reset session"));
          }}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Reset session (start fresh context)"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "terminal" && (
        <div className="space-y-3">
          <form onSubmit={handleExecute} className="flex gap-2 items-end">
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
              placeholder={`Message ${name}... (Shift+Enter for new line)`}
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
          </form>
          <div className="h-[500px]">
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
        <FilesBrowser projectName={name} />
      )}
    </div>
  );
}
