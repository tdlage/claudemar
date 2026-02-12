import { useState, useEffect } from "react";
import { Save, RefreshCw, Download, CheckCircle } from "lucide-react";
import { api } from "../lib/api";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { Badge } from "../components/shared/Badge";
import { MarkdownEditor } from "../components/shared/MarkdownEditor";
import { useToast } from "../components/shared/Toast";

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

type TabKey = "claude-md" | "settings";

export function OrchestratorPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useState<TabKey>("claude-md");

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
  }, []);

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
    { key: "claude-md", label: "CLAUDE.md" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Orchestrator</h1>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

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
