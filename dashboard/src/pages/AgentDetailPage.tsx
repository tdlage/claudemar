import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Square, Map, ListOrdered, Zap } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { InboxList } from "../components/agent/InboxList";
import { OutboxList } from "../components/agent/OutboxList";
import { OutputBrowser, type OutputFile } from "../components/agent/OutputBrowser";
import { InputBrowser, type InputFile } from "../components/agent/InputBrowser";
import { AgentConfig } from "../components/agent/AgentConfig";
import { AgentContextFiles } from "../components/agent/AgentContextFiles";
import { AgentSecrets } from "../components/agent/AgentSecrets";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { VoiceInput } from "../components/shared/VoiceInput";
import { SessionSelector } from "../components/shared/SessionSelector";
import type { AgentDetail } from "../lib/types";

type TabKey = "terminal" | "code" | "inbox" | "outbox" | "input" | "output" | "config" | "context" | "secrets";

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useCachedState<TabKey>(`agent:${name}:tab`, "terminal");
  const [prompt, setPrompt] = useCachedState(`agent:${name}:prompt`, "");
  const [planMode, setPlanMode] = useCachedState(`agent:${name}:planMode`, false);
  const [sequential, setSequential] = useCachedState(`agent:${name}:sequential`, false);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [selectedSkill, setSelectedSkill] = useCachedState(`agent:${name}:skill`, "");
  const [outputFiles, setOutputFiles] = useState<OutputFile[]>([]);
  const [inputFiles, setInputFiles] = useState<InputFile[]>([]);

  const loadOutputs = useCallback(() => {
    if (!name) return;
    api.get<OutputFile[]>(`/agents/${name}/output`).then(setOutputFiles).catch(() => {});
  }, [name]);

  const loadInputs = useCallback(() => {
    if (!name) return;
    api.get<InputFile[]>(`/agents/${name}/input`).then(setInputFiles).catch(() => {});
  }, [name]);

  const {
    execId, setExecId, isRunning, sessionData, loadSession,
    handleSessionChange, handleSessionRename,
    activity, filteredQueue, filteredQuestions, submitAnswer,
    expandedExecId, toggleExpanded, addToast,
  } = useExecutionPage({
    targetType: "agent",
    targetName: name ?? "",
    cachePrefix: `agent:${name}`,
    onExecutionComplete: loadOutputs,
  });

  const loadAgent = useCallback(() => {
    if (!name) return;
    api.get<AgentDetail>(`/agents/${name}`).then((data) => {
      setAgent(data);
      setOutputFiles(data.outputFiles);
      setInputFiles(data.inputFiles);
    }).catch(() => {});
  }, [name]);

  useEffect(() => {
    loadAgent();
    loadSession();
    loadOutputs();
    loadInputs();
    api.get<{ name: string; description: string }[]>("/projects/claude-skills").then(setSkills).catch(() => {});
  }, [loadAgent, loadSession, loadOutputs, loadInputs]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !name) return;

    try {
      const finalPrompt = selectedSkill ? `/${selectedSkill} ${prompt.trim()}` : prompt.trim();
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "agent",
        targetName: name,
        prompt: finalPrompt,
        resumeSessionId: sessionData.sessionId,
        planMode,
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

  if (!agent) {
    return <p className="text-text-muted">Loading...</p>;
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "code", label: "Code" },
    { key: "inbox", label: `Inbox (${agent.inboxFiles.length})` },
    { key: "outbox", label: `Outbox (${agent.outboxFiles.length})` },
    { key: "input", label: `Input (${inputFiles.length})` },
    { key: "output", label: `Output (${outputFiles.length})` },
    { key: "config", label: "Config" },
    { key: "context", label: `Context (${agent.contextFiles.length})` },
    { key: "secrets", label: `Secrets (${agent.secrets.length})` },
  ];

  return (
    <div className={`flex flex-col gap-4 ${tab === "code" ? "h-full" : ""}`}>
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <h1 className="text-base md:text-lg font-semibold">{agent.name}</h1>
        <Badge>{agent.inboxCount} inbox</Badge>
        {agent.schedules.length > 0 && (
          <Badge variant="info">{agent.schedules.length} schedules</Badge>
        )}
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
            <div className="flex items-center gap-2">
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

      {tab === "code" && name && (
        <div className="flex-1 min-h-0">
          <FilesBrowser base={`agent:${name}`} />
        </div>
      )}

      {tab === "inbox" && (
        <InboxList agentName={agent.name} files={agent.inboxFiles} onRefresh={loadAgent} />
      )}

      {tab === "outbox" && (
        <OutboxList agentName={agent.name} files={agent.outboxFiles} onRefresh={loadAgent} />
      )}

      {tab === "input" && (
        <InputBrowser apiBasePath={`/agents/${agent.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {tab === "output" && (
        <OutputBrowser agentName={agent.name} files={outputFiles} onRefresh={loadOutputs} />
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
