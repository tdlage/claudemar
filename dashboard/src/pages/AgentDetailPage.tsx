import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Square } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { InboxList } from "../components/agent/InboxList";
import { OutboxList } from "../components/agent/OutboxList";
import { OutputBrowser } from "../components/agent/OutputBrowser";
import { AgentConfig } from "../components/agent/AgentConfig";
import { useExecutions } from "../hooks/useExecution";
import { useToast } from "../components/shared/Toast";
import type { AgentDetail } from "../lib/types";

type TabKey = "terminal" | "inbox" | "outbox" | "output" | "config";

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { addToast } = useToast();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("terminal");
  const [prompt, setPrompt] = useState("");
  const [execId, setExecId] = useState<string | null>(null);
  const { active } = useExecutions();
  const activeExec = execId ? active.find((e) => e.id === execId) : undefined;
  const isRunning = !!activeExec;

  const loadAgent = useCallback(() => {
    if (!name) return;
    api.get<AgentDetail>(`/agents/${name}`).then(setAgent).catch(() => {});
  }, [name]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === "agent" && e.targetName === name);
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      setExecId(null);
    }
  }, [name, active]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !name) return;

    try {
      const { id } = await api.post<{ id: string }>("/executions", {
        targetType: "agent",
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

  if (!agent) {
    return <p className="text-text-muted">Loading...</p>;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "inbox", label: `Inbox (${agent.inboxFiles.length})` },
    { key: "outbox", label: `Outbox (${agent.outboxFiles.length})` },
    { key: "output", label: `Output (${agent.outputFiles.length})` },
    { key: "config", label: "Config" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{agent.name}</h1>
        <Badge>{agent.inboxCount} inbox</Badge>
        {agent.schedules.length > 0 && (
          <Badge variant="info">{agent.schedules.length} schedules</Badge>
        )}
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
            <Terminal executionId={execId} initialOutput={activeExec?.output} />
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
          contextFiles={agent.contextFiles}
          schedules={agent.schedules}
          onRefresh={loadAgent}
        />
      )}
    </div>
  );
}
