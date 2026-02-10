import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { RotateCcw, Square } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { useExecutions } from "../hooks/useExecution";
import { useToast } from "../components/shared/Toast";
import type { ProjectDetail } from "../lib/types";

type TabKey = "terminal" | "files";

export function ProjectDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { addToast } = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("terminal");
  const [prompt, setPrompt] = useState("");
  const [execId, setExecId] = useState<string | null>(null);
  const [expandedExecId, setExpandedExecId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { active, recent } = useExecutions();

  const projectActive = active.filter((e) => e.targetName === name);
  const projectRecent = recent.filter((e) => e.targetName === name);
  const projectActivity = [...projectActive, ...projectRecent];
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
      const { id } = await api.post<{ id: string }>("/executions", {
        targetType: "project",
        targetName: name,
        prompt: prompt.trim(),
      });
      setExecId(id);
      setPrompt("");
      addToast("success", "Execution started");
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
    { key: "files", label: "Files" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{project.name}</h1>
        {project.gitInfo && (
          <span className="text-xs text-text-muted bg-surface px-2 py-0.5 rounded border border-border">
            {project.gitInfo.branch}
          </span>
        )}
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
          <form onSubmit={handleExecute} className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Message ${name}...`}
              className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
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

          {projectActivity.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-text-muted mb-2">Activity</h2>
              <ActivityFeed
                executions={projectActivity}
                expandedId={expandedExecId}
                onToggle={toggleExpanded}
              />
            </div>
          )}
        </div>
      )}

      {tab === "files" && name && (
        <FilesBrowser projectName={name} />
      )}
    </div>
  );
}
