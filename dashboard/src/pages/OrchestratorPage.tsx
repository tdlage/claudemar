import { useState, useEffect, useRef } from "react";
import { Save } from "lucide-react";
import { api } from "../lib/api";
import { Tabs } from "../components/shared/Tabs";
import { Button } from "../components/shared/Button";
import { useToast } from "../components/shared/Toast";

interface OrchestratorSettings {
  prependPrompt: string;
  model: string;
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
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [settings, setSettings] = useState<OrchestratorSettings>({ prependPrompt: "", model: "claude-opus-4-6" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

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

  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSaveMd();
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
          <textarea
            ref={editorRef}
            value={mdContent}
            onChange={(e) => {
              setMdContent(e.target.value);
              setMdDirty(true);
            }}
            onKeyDown={handleEditorKeyDown}
            className="w-full h-96 bg-bg border border-border rounded-md p-4 text-sm text-text-primary font-mono resize-y focus:outline-none focus:border-accent"
            spellCheck={false}
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
        </div>
      )}
    </div>
  );
}
