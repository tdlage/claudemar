import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Square, Map } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { InboxList } from "../components/agent/InboxList";
import { OutboxList } from "../components/agent/OutboxList";
import { OutputBrowser } from "../components/agent/OutputBrowser";
import { AgentConfig } from "../components/agent/AgentConfig";
import { AgentContextFiles } from "../components/agent/AgentContextFiles";
import { AgentSecrets } from "../components/agent/AgentSecrets";
import { useExecutions } from "../hooks/useExecution";
import { useToast } from "../components/shared/Toast";
import { useCachedState } from "../hooks/useCachedState";
import { VoiceInput } from "../components/shared/VoiceInput";
import type { AgentDetail } from "../lib/types";

type TabKey = "terminal" | "inbox" | "outbox" | "output" | "config" | "context" | "secrets";

interface SessionData {
  sessionId: string | null;
  history: string[];
}

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { addToast } = useToast();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useCachedState<TabKey>(`agent:${name}:tab`, "terminal");
  const [prompt, setPrompt] = useCachedState(`agent:${name}:prompt`, "");
  const [planMode, setPlanMode] = useCachedState(`agent:${name}:planMode`, false);
  const [execId, setExecId] = useCachedState<string | null>(`agent:${name}:execId`, null);
  const [sessionData, setSessionData] = useState<SessionData>({ sessionId: null, history: [] });
  const { active, pendingQuestions, submitAnswer } = useExecutions();
  const activeExec = execId ? active.find((e) => e.id === execId) : undefined;
  const isRunning = !!activeExec;

  const loadAgent = useCallback(() => {
    if (!name) return;
    api.get<AgentDetail>(`/agents/${name}`).then(setAgent).catch(() => {});
  }, [name]);

  const loadSession = useCallback(() => {
    if (!name) return;
    api.get<SessionData>(`/executions/session/agent/${name}`)
      .then(setSessionData)
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    loadAgent();
    loadSession();
  }, [loadAgent, loadSession]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === "agent" && e.targetName === name);
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      loadSession();
    }
  }, [name, active, execId, loadSession]);

  const handleSessionChange = async (value: string) => {
    if (!name) return;
    if (value === "__new") {
      try {
        await api.delete(`/executions/session/agent/${name}`);
        setSessionData((prev) => ({ ...prev, sessionId: null }));
        addToast("success", "New session");
      } catch {
        addToast("error", "Failed to reset session");
      }
    } else {
      try {
        await api.put(`/executions/session/agent/${name}`, { sessionId: value });
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
      const { id } = await api.post<{ id: string }>("/executions", {
        targetType: "agent",
        targetName: name,
        prompt: prompt.trim(),
        planMode,
      });
      setExecId(id);
      setPrompt("");
      setPlanMode(false);
      addToast("success", "Execution started");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed");
    }
  };

  if (!agent) {
    return <p className="text-text-muted">Loading...</p>;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "inbox", label: `Inbox (${agent.inboxFiles.length})` },
    { key: "outbox", label: `Outbox (${agent.outboxFiles.length})` },
    { key: "output", label: `Output (${agent.outputFiles.length})` },
    { key: "config", label: "Config" },
    { key: "context", label: `Context (${agent.contextFiles.length})` },
    { key: "secrets", label: `Secrets (${agent.secrets.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{agent.name}</h1>
        <Badge>{agent.inboxCount} inbox</Badge>
        {agent.schedules.length > 0 && (
          <Badge variant="info">{agent.schedules.length} schedules</Badge>
        )}
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
            .filter((pq) => pq.info.targetType === "agent" && pq.info.targetName === name)
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
          <form onSubmit={handleExecute} className="flex gap-2 items-end">
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
              placeholder={`Message ${name}... (Shift+Enter for new line)`}
              rows={1}
              className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none overflow-y-auto"
              style={{ maxHeight: 200 }}
            />
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
        </div>
      )}

      {tab === "inbox" && (
        <InboxList agentName={agent.name} files={agent.inboxFiles} onRefresh={loadAgent} />
      )}

      {tab === "outbox" && (
        <OutboxList agentName={agent.name} files={agent.outboxFiles} onRefresh={loadAgent} />
      )}

      {tab === "output" && (
        <OutputBrowser agentName={agent.name} files={agent.outputFiles} />
      )}

      {tab === "config" && (
        <AgentConfig
          agentName={agent.name}
          claudeMd={agent.claudeMd}
          schedules={agent.schedules}
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
    </div>
  );
}
