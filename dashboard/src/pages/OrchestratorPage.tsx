import { useState, useEffect } from "react";
import { Save, RefreshCw, Download, CheckCircle, Crown, Container, Cpu } from "lucide-react";
import { api } from "../lib/api";
import { Terminal, type StartOpts } from "../components/terminal/Terminal";
import { QuestionPanel } from "../components/terminal/QuestionPanel";
import type { ImageBlock } from "../lib/imageBlock";
import { ExecutionActivity } from "../components/terminal/ExecutionActivity";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { useCachedState } from "../hooks/useCachedState";
import { useExecutionPage } from "../hooks/useExecutionPage";
import { useCurrentModel } from "../hooks/useCurrentModel";
import { SessionSelector } from "../components/shared/SessionSelector";

interface OrchestratorSettings {
  prependPrompt: string;
}

interface UpdateInfo {
  available: boolean;
  currentCommit: string;
  currentDate: string;
  remoteCommit: string;
  commitCount: number;
  commits: string[];
}


type TabKey = "terminal" | "agents-md" | "settings";

export function OrchestratorPage() {
  const currentModel = useCurrentModel();
  const [tab, setTab] = useCachedState<TabKey>("orchestrator:tab", "terminal");

  const {
    execId, setExecId, isRunning, sessionData, loadSession,
    handleSessionChange, handleSessionRename, handleSessionDelete,
    activity, historyLimit, setHistoryLimit, sessionFilter, setSessionFilter,
    filteredQueue, filteredQuestions, submitAnswer,
    expandedExecId, toggleExpanded, addToast,
    searchQuery, handleSearchChange,
  } = useExecutionPage({
    targetType: "orchestrator",
    targetName: "orchestrator",
    cachePrefix: "orchestrator",
  });

  const [mdContent, setMdContent] = useState("");
  const [mdDirty, setMdDirty] = useState(false);
  const [mdSaving, setMdSaving] = useState(false);

  const [settings, setSettings] = useState<OrchestratorSettings>({ prependPrompt: "" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [dockerRebuilding, setDockerRebuilding] = useState(false);

  useEffect(() => {
    api.get<{ content: string }>("/orchestrator/agents-md")
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

  const handleStart = async (text: string, images: ImageBlock[], opts: StartOpts) => {
    if (!text.trim() && images.length === 0) return;

    try {
      const finalPrompt = text.trim();
      const blocks = images.length > 0 ? [...images, { type: "text" as const, text: finalPrompt }] : undefined;
      const result = await api.post<{ id?: string; queued?: boolean; queueItem?: { seqId: number } }>("/executions", {
        targetType: "orchestrator",
        targetName: "orchestrator",
        prompt: finalPrompt,
        blocks,
        resumeSessionId: sessionData.sessionId,
        planMode: opts.planMode,
        permissionMode: opts.permissionMode,
        effort: opts.effort,
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

  const handleSaveMd = async () => {
    setMdSaving(true);
    try {
      await api.put("/orchestrator/agents-md", { content: mdContent });
      setMdDirty(false);
      addToast("success", "AGENTS.md saved");
    } catch {
      addToast("error", "Failed to save AGENTS.md");
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

  const handleDockerRebuild = async () => {
    setDockerRebuilding(true);
    try {
      await api.post("/system/docker/rebuild");
      addToast("success", "Docker image rebuilt");
    } catch {
      addToast("error", "Failed to rebuild Docker image");
    } finally {
      setDockerRebuilding(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "terminal", label: "Terminal" },
    { key: "agents-md", label: "AGENTS.md" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Crown size={20} className="text-amber-400" />
        <h1 className="text-lg font-semibold">Claudemar</h1>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "terminal" && (
        <div className="space-y-3">
          {filteredQuestions.map((pq) => (
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
          <div className="h-[500px]">
            <Terminal
              executionId={execId}
              base="orchestrator"
              startPlaceholder="Message orchestrator... (Shift+Enter quebra linha)"
              isLive={isRunning}
              onStart={handleStart}
              inputControls={
                <SessionSelector
                  sessionData={sessionData}
                  onChange={handleSessionChange}
                  onRename={handleSessionRename}
                  onDelete={handleSessionDelete}
                  disabled={isRunning}
                  disabledTitle="Novas mensagens entram na execução atual enquanto ela roda — aguarde terminar para mudar de sessão"
                />
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

      {tab === "agents-md" && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text-muted">AGENTS.md</h3>
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
              Modelo
            </label>
            <div className="inline-flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary">
              <Cpu size={14} className="text-text-muted" />
              <span className="font-medium">{currentModel.displayName}</span>
            </div>
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

          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-medium text-text-muted mb-3">Docker</h3>
            <Button size="sm" variant="secondary" onClick={handleDockerRebuild} disabled={dockerRebuilding}>
              <Container size={12} className={`mr-1.5 ${dockerRebuilding ? "animate-spin" : ""}`} />
              {dockerRebuilding ? "Rebuilding..." : "Rebuild image"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
