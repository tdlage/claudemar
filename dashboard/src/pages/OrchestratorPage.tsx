import { useState, useEffect, useCallback } from "react";
import { Save, RefreshCw, Download, CheckCircle, Square, Map } from "lucide-react";
import { api } from "../lib/api";
import { Terminal } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import { ActivityFeed } from "../components/overview/ActivityFeed";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { useExecutions } from "../hooks/useExecution";
import { useToast } from "../components/shared/Toast";
import { useCachedState } from "../hooks/useCachedState";
import { VoiceInput } from "../components/shared/VoiceInput";

interface OrchestratorSettings {
  prependPrompt: string;
  model: string;
}

interface UpdateInfo {
  available: boolean;
  currentCommit: string;
  currentDate: string;
  remoteCommit: string;
  commitCount: number;
  commits: string[];
}

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Opus 4.6 (default)" },
  { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

interface SessionData {
  sessionId: string | null;
  history: string[];
}

type TabKey = "terminal" | "claude-md" | "settings";

export function OrchestratorPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useCachedState<TabKey>("orchestrator:tab", "terminal");
  const [prompt, setPrompt] = useCachedState("orchestrator:prompt", "");
  const [planMode, setPlanMode] = useCachedState("orchestrator:planMode", false);
  const [execId, setExecId] = useCachedState<string | null>("orchestrator:execId", null);
  const [expandedExecId, setExpandedExecId] = useCachedState<string | null>("orchestrator:expandedExecId", null);
  const [sessionData, setSessionData] = useState<SessionData>({ sessionId: null, history: [] });
  const { active, recent, queue, pendingQuestions, submitAnswer } = useExecutions();

  const orchActive = active.filter((e) => e.targetType === "orchestrator");
  const orchRecent = recent.filter((e) => e.targetType === "orchestrator");
  const orchActivity = [...orchActive, ...orchRecent];
  const orchQueue = queue.filter((q) => q.targetType === "orchestrator");
  const activeExec = execId ? active.find((e) => e.id === execId) : undefined;
  const isRunning = !!activeExec;

  const [mdContent, setMdContent] = useState("");
  const [mdDirty, setMdDirty] = useState(false);
  const [mdSaving, setMdSaving] = useState(false);

  const [settings, setSettings] = useState<OrchestratorSettings>({ prependPrompt: "", model: "claude-opus-4-6" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const loadSession = useCallback(() => {
    api.get<SessionData>("/executions/session/orchestrator/orchestrator")
      .then(setSessionData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get<{ content: string }>("/orchestrator/claude-md")
      .then((data) => setMdContent(data.content))
      .catch(() => {});

    api.get<OrchestratorSettings>("/orchestrator/settings")
      .then((data) => {
        setSettings(data);
        setSettingsLoaded(true);
      })
      .catch(() => setSettingsLoaded(true));

    loadSession();
  }, [loadSession]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === "orchestrator");
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      loadSession();
    }
  }, [active, execId, loadSession]);

  const handleSessionChange = async (value: string) => {
    if (value === "__new") {
      try {
        await api.delete("/executions/session/orchestrator/orchestrator");
        setSessionData((prev) => ({ ...prev, sessionId: null }));
        addToast("success", "New session");
      } catch {
        addToast("error", "Failed to reset session");
      }
    } else {
      try {
        await api.put("/executions/session/orchestrator/orchestrator", { sessionId: value });
        setSessionData((prev) => ({ ...prev, sessionId: value }));
        addToast("success", `Session switched to ${value.slice(0, 8)}`);
      } catch {
        addToast("error", "Failed to switch session");
      }
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    try {
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "orchestrator",
        targetName: "orchestrator",
        prompt: prompt.trim(),
        planMode,
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

  const handleSaveMd = async () => {
    setMdSaving(true);
    try {
      await api.put("/orchestrator/claude-md", { content: mdContent });
      setMdDirty(false);
      addToast("success", "CLAUDE.md saved");
    } catch {
      addToast("error", "Failed to save CLAUDE.md");
    } finally {
      setMdSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      await api.put("/orchestrator/settings", settings);
      setSettingsDirty(false);
      addToast("success", "Settings saved");
    } catch {
      addToast("error", "Failed to save settings");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    try {
      const info = await api.get<UpdateInfo>("/system/update-check");
      setUpdateInfo(info);
      if (!info.available) addToast("success", "Already up to date");
    } catch {
      addToast("error", "Failed to check for updates");
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const result = await api.post<{ success: boolean; output: string }>("/system/update");
      if (result.success) {
        addToast("success", "Update complete — service restarting...");
      } else {
        addToast("error", "Update failed");
      }
    } catch {
      addToast("error", "Update request failed");
    } finally {
      setUpdating(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "claude-md", label: "CLAUDE.md" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Orchestrator</h1>
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
            .filter((pq) => pq.info.targetType === "orchestrator")
            .map((pq) => (
              <QuestionPanel
                key={pq.execId}
                execId={pq.execId}
                question={pq.question}
                targetName="orchestrator"
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
              placeholder="Message orchestrator... (Shift+Enter for new line)"
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
            <Terminal executionId={execId} />
          </div>

          {(orchActivity.length > 0 || orchQueue.length > 0) && (
            <div>
              <h2 className="text-sm font-medium text-text-muted mb-2">Activity</h2>
              <ActivityFeed
                executions={orchActivity}
                queue={orchQueue}
                expandedId={expandedExecId}
                onToggle={toggleExpanded}
              />
            </div>
          )}
        </div>
      )}

      {tab === "claude-md" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text-muted">CLAUDE.md</h3>
            <Button
              size="sm"
              onClick={handleSaveMd}
              disabled={mdSaving || !mdDirty}
            >
              <Save size={12} className="mr-1" />
              {mdSaving ? "Saving..." : "Save"}
            </Button>
          </div>
          <MarkdownEditor
            value={mdContent}
            onChange={(md) => {
              setMdContent(md);
              setMdDirty(true);
            }}
            onSave={handleSaveMd}
            placeholder="Write orchestrator instructions here..."
          />
        </div>
      )}

      {tab === "settings" && settingsLoaded && (
        <div className="space-y-6 max-w-xl">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">
              Prepend Prompt
            </label>
            <textarea
              value={settings.prependPrompt}
              onChange={(e) => {
                setSettings({ ...settings, prependPrompt: e.target.value });
                setSettingsDirty(true);
              }}
              className="w-full h-40 bg-bg border border-border rounded-md p-4 text-sm text-text-primary font-mono resize-y focus:outline-none focus:border-accent"
              spellCheck={false}
              placeholder="Text prepended to every orchestrator execution prompt..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">
              Model
            </label>
            <select
              value={settings.model}
              onChange={(e) => {
                setSettings({ ...settings, model: e.target.value });
                setSettingsDirty(true);
              }}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            onClick={handleSaveSettings}
            disabled={settingsSaving || !settingsDirty}
          >
            <Save size={14} className="mr-1.5" />
            {settingsSaving ? "Saving..." : "Save Settings"}
          </Button>

          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-medium text-text-muted mb-3">System Update</h3>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" onClick={handleCheckUpdate} disabled={updateChecking || updating}>
                <RefreshCw size={12} className={`mr-1.5 ${updateChecking ? "animate-spin" : ""}`} />
                {updateChecking ? "Checking..." : "Check for updates"}
              </Button>
              {updateInfo?.available && (
                <Button size="sm" onClick={handleUpdate} disabled={updating}>
                  <Download size={12} className={`mr-1.5 ${updating ? "animate-bounce" : ""}`} />
                  {updating ? "Updating..." : "Update now"}
                </Button>
              )}
            </div>
            {updateInfo && (
              <div className="mt-3 text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">Current:</span>
                  <span className="font-mono text-xs">{updateInfo.currentCommit}</span>
                  <span className="text-text-muted text-xs">({new Date(updateInfo.currentDate).toLocaleDateString()})</span>
                </div>
                {updateInfo.available ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">{updateInfo.commitCount} new commit{updateInfo.commitCount > 1 ? "s" : ""}</Badge>
                    </div>
                    <ul className="space-y-0.5 text-xs font-mono text-text-muted bg-surface rounded-md p-2 border border-border">
                      {updateInfo.commits.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-green-500">
                    <CheckCircle size={14} />
                    <span>Up to date</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
