import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { ListOrdered, Zap, FileText } from "lucide-react";
import { api } from "../lib/api";
import { Terminal, type StartOpts } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import type { ImageBlock } from "../lib/imageBlock";
import { ExecutionActivity } from "../components/terminal/ExecutionActivity";
import { Tabs } from "../components/shared/Tabs";
import { Badge } from "../components/shared/Badge";
import { ToggleButton } from "../components/shared/ToggleButton";
import { MessageList } from "../components/agent/MessageList";
import { OutputBrowser, type OutputFile } from "../components/agent/OutputBrowser";
import { InputBrowser, type InputFile } from "../components/agent/InputBrowser";
import { AgentConfig } from "../components/agent/AgentConfig";
import { AgentContextFiles } from "../components/agent/AgentContextFiles";
import { AgentSecrets } from "../components/agent/AgentSecrets";
import { FilesBrowser } from "../components/project/FilesBrowser";
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { SessionSelector } from "../components/shared/SessionSelector";
import type { AgentDetail } from "../lib/types";

type TabKey = "terminal" | "code" | "inbox" | "outbox" | "input" | "output" | "config" | "context" | "secrets";

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useCachedState<TabKey>(`agent:${name}:tab`, "terminal");
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
    execId, setExecId, sessionData, loadSession,
    handleSessionChange, handleSessionRename, handleSessionDelete,
    activity, historyLimit, setHistoryLimit, sessionFilter, setSessionFilter,
    filteredQueue, filteredQuestions, submitAnswer,
    expandedExecId, toggleExpanded, addToast,
    searchQuery, handleSearchChange,
  } = useExecutionPage({
    targetType: "agent",
    targetName: name ?? "",
    cachePrefix: `agent:${name}`,
    onExecutionComplete: loadOutputs,
  });

  const [sendSystemPrompt, setSendSystemPrompt] = useState(!sessionData.sessionId);

  useEffect(() => {
    setSendSystemPrompt(!sessionData.sessionId);
  }, [sessionData.sessionId]);

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

  const handleStart = async (text: string, images: ImageBlock[], opts: StartOpts) => {
    if ((!text.trim() && images.length === 0) || !name) return;

    try {
      const finalPrompt = selectedSkill ? `/${selectedSkill} ${text.trim()}` : text.trim();
      const blocks = images.length > 0 ? [...images, { type: "text" as const, text: finalPrompt }] : undefined;
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "agent",
        targetName: name,
        prompt: finalPrompt,
        blocks,
        resumeSessionId: sessionData.sessionId,
        planMode: opts.planMode,
        permissionMode: opts.permissionMode,
        thinking: opts.thinking,
        forceQueue: sequential || undefined,
        skipSystemPrompt: !sendSystemPrompt || undefined,
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
          onDelete={handleSessionDelete}
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
          <div className="h-[300px] md:h-[500px]">
            <Terminal
              key={name}
              executionId={execId}
              base={`agent:${name}`}
              startPlaceholder={`Message ${name}...`}
              queueMode={sequential}
              onStart={handleStart}
              controls={
                <>
                  <ToggleButton
                    active={sequential}
                    onToggle={() => setSequential(!sequential)}
                    icon={ListOrdered}
                    label="Queue"
                    title={sequential ? "Sequential mode ON (commands queue in order)" : "Sequential mode OFF (parallel execution)"}
                  />
                  <ToggleButton
                    active={sendSystemPrompt}
                    onToggle={() => setSendSystemPrompt(!sendSystemPrompt)}
                    icon={FileText}
                    label="System"
                    title={sendSystemPrompt ? "System prompt will be sent (click to skip)" : "System prompt will NOT be sent (click to include)"}
                  />
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

      {tab === "code" && name && (
        <div className="flex-1 min-h-0">
          <FilesBrowser base={`agent:${name}`} />
        </div>
      )}

      {tab === "inbox" && (
        <MessageList kind="inbox" agentName={agent.name} files={agent.inboxFiles} onRefresh={loadAgent} />
      )}

      {tab === "outbox" && (
        <MessageList kind="outbox" agentName={agent.name} files={agent.outboxFiles} onRefresh={loadAgent} />
      )}

      {tab === "input" && (
        <InputBrowser apiBasePath={`/agents/${agent.name}`} base={`agent:${agent.name}`} files={inputFiles} onRefresh={loadInputs} />
      )}

      {tab === "output" && (
        <OutputBrowser agentName={agent.name} files={outputFiles} onRefresh={loadOutputs} />
      )}

      {tab === "config" && (
        <AgentConfig
          agentName={agent.name}
          agentsMd={agent.agentsMd}
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
