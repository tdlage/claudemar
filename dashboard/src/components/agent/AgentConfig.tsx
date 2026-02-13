import { useState, useEffect } from "react";
import { Save, Plus, Trash2, Play, FileText, Pencil, Eye, EyeOff, KeyRound } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { Modal } from "../shared/Modal";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useToast } from "../shared/Toast";
import type { AgentFileContent, AgentSecret, ScheduleEntry } from "../../lib/types";

interface AgentConfigProps {
  agentName: string;
  claudeMd: string;
  contextFiles: string[];
  schedules: ScheduleEntry[];
  secrets: AgentSecret[];
  onRefresh: () => void;
}

export function AgentConfig({ agentName, claudeMd, contextFiles, schedules, secrets, onRefresh }: AgentConfigProps) {
  const { addToast } = useToast();
  const [mdContent, setMdContent] = useState(claudeMd);
  const [mdDirty, setMdDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [contextExpanded, setContextExpanded] = useState<string | null>(null);
  const [contextContents, setContextContents] = useState<Record<string, string>>({});

  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");

  const [secretFormOpen, setSecretFormOpen] = useState(false);
  const [editingSecret, setEditingSecret] = useState<AgentSecret | null>(null);
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretDescription, setSecretDescription] = useState("");
  const [secretValueVisible, setSecretValueVisible] = useState(false);
  const [savingSecret, setSavingSecret] = useState(false);

  useEffect(() => {
    setMdContent(claudeMd);
    setMdDirty(false);
  }, [claudeMd]);

  const handleSaveMd = async () => {
    setSaving(true);
    try {
      await api.put(`/files?base=agent:${agentName}&path=CLAUDE.md`, { content: mdContent });
      setMdDirty(false);
      addToast("success", "CLAUDE.md saved");
    } catch {
      addToast("error", "Failed to save CLAUDE.md");
    } finally {
      setSaving(false);
    }
  };

  const toggleContext = async (file: string) => {
    if (contextExpanded === file) {
      setContextExpanded(null);
      return;
    }
    setContextExpanded(file);
    if (contextContents[file] === undefined) {
      try {
        const data = await api.get<AgentFileContent>(`/agents/${agentName}/context/${file}`);
        setContextContents((prev) => ({ ...prev, [file]: data.content }));
      } catch {
        addToast("error", "Failed to load context file");
      }
    }
  };

  const handleDeleteContext = async (file: string) => {
    try {
      await api.delete(`/agents/${agentName}/context/${file}`);
      addToast("success", "Context file deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete");
    }
  };

  const handleCreateContext = async () => {
    if (!newFileName.trim()) return;
    try {
      await api.post(`/agents/${agentName}/context`, {
        filename: newFileName.trim(),
        content: newFileContent,
      });
      addToast("success", "Context file created");
      setNewFileOpen(false);
      setNewFileName("");
      setNewFileContent("");
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to create");
    }
  };

  const handleExecuteSchedule = async (schedule: ScheduleEntry) => {
    try {
      await api.post("/executions", {
        targetType: "agent",
        targetName: agentName,
        prompt: schedule.task,
      });
      addToast("success", "Schedule task started");
    } catch {
      addToast("error", "Failed to start task");
    }
  };

  const openNewSecret = () => {
    setEditingSecret(null);
    setSecretName("");
    setSecretValue("");
    setSecretDescription("");
    setSecretValueVisible(false);
    setSecretFormOpen(true);
  };

  const openEditSecret = (secret: AgentSecret) => {
    setEditingSecret(secret);
    setSecretName(secret.name);
    setSecretValue("");
    setSecretDescription(secret.description);
    setSecretValueVisible(false);
    setSecretFormOpen(true);
  };

  const handleSaveSecret = async () => {
    if (!secretName.trim()) return;
    setSavingSecret(true);
    try {
      if (editingSecret) {
        await api.put(`/agents/${agentName}/secrets/${editingSecret.id}`, {
          name: secretName.trim(),
          value: secretValue || undefined,
          description: secretDescription,
        });
        addToast("success", "Secret updated");
      } else {
        if (!secretValue) {
          addToast("error", "Value is required for new secrets");
          setSavingSecret(false);
          return;
        }
        await api.post(`/agents/${agentName}/secrets`, {
          name: secretName.trim(),
          value: secretValue,
          description: secretDescription,
        });
        addToast("success", "Secret created");
      }
      setSecretFormOpen(false);
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to save secret");
    } finally {
      setSavingSecret(false);
    }
  };

  const handleDeleteSecret = async (id: string) => {
    if (!confirm("Delete this secret?")) return;
    try {
      await api.delete(`/agents/${agentName}/secrets/${id}`);
      addToast("success", "Secret deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete secret");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">CLAUDE.md</h3>
          <Button
            size="sm"
            onClick={handleSaveMd}
            disabled={saving || !mdDirty}
          >
            <Save size={12} className="mr-1" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        <MarkdownEditor
          value={mdContent}
          onChange={(md) => {
            setMdContent(md);
            setMdDirty(true);
          }}
          onSave={handleSaveMd}
          placeholder="Write agent instructions..."
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">
            Context Files ({contextFiles.length})
          </h3>
          <Button size="sm" variant="secondary" onClick={() => setNewFileOpen(true)}>
            <Plus size={12} className="mr-1" /> New
          </Button>
        </div>
        {contextFiles.length === 0 ? (
          <p className="text-sm text-text-muted">No context files.</p>
        ) : (
          <div className="space-y-2">
            {contextFiles.map((file) => (
              <Card key={file} className="p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2">
                  <button
                    onClick={() => toggleContext(file)}
                    className="flex items-center gap-2 flex-1 text-left hover:text-accent transition-colors"
                  >
                    <FileText size={14} className="text-text-muted" />
                    <span className="text-sm text-text-primary">{file}</span>
                  </button>
                  <Button size="sm" variant="danger" onClick={() => handleDeleteContext(file)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
                {contextExpanded === file && contextContents[file] !== undefined && (
                  <div className="border-t border-border">
                    <pre className="px-4 py-3 text-sm text-text-secondary whitespace-pre-wrap overflow-auto max-h-64 bg-bg font-mono">
                      {contextContents[file]}
                    </pre>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">
            Secrets ({secrets.length})
          </h3>
          <Button size="sm" variant="secondary" onClick={openNewSecret}>
            <Plus size={12} className="mr-1" /> New
          </Button>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Secrets are injected as environment variables during agent execution.
        </p>
        {secrets.length === 0 ? (
          <p className="text-sm text-text-muted">No secrets configured.</p>
        ) : (
          <div className="space-y-2">
            {secrets.map((secret) => (
              <Card key={secret.id} className="py-2 px-4">
                <div className="flex items-center gap-3">
                  <KeyRound size={14} className="text-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary font-mono">{secret.name}</p>
                    <p className="text-xs text-text-muted font-mono">{secret.maskedValue}</p>
                    {secret.description && (
                      <p className="text-xs text-text-secondary mt-0.5">{secret.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="secondary" onClick={() => openEditSecret(secret)}>
                      <Pencil size={12} />
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteSecret(secret.id)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {schedules.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-muted mb-2">
            Schedules ({schedules.length})
          </h3>
          <div className="space-y-2">
            {schedules.map((s) => (
              <Card key={s.id} className="py-2 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge>{s.cron}</Badge>
                      <span className="text-xs text-text-muted">{s.cronHuman}</span>
                    </div>
                    <p className="text-sm text-text-primary truncate">{s.task}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => handleExecuteSchedule(s)}>
                    <Play size={12} className="mr-1" /> Run Now
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Modal open={newFileOpen} onClose={() => setNewFileOpen(false)} title="New Context File">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Filename</label>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="e.g. guidelines.md"
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Content</label>
            <textarea
              value={newFileContent}
              onChange={(e) => setNewFileContent(e.target.value)}
              rows={8}
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-mono resize-y focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewFileOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateContext} disabled={!newFileName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={secretFormOpen}
        onClose={() => setSecretFormOpen(false)}
        title={editingSecret ? "Edit Secret" : "New Secret"}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Name</label>
            <input
              type="text"
              value={secretName}
              onChange={(e) => setSecretName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="e.g. XPTO_API_KEY"
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Value {editingSecret && <span className="text-text-muted">(leave empty to keep current)</span>}
            </label>
            <div className="relative">
              <input
                type={secretValueVisible ? "text" : "password"}
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder={editingSecret ? "Leave empty to keep current value" : "Secret value"}
                className="w-full bg-bg border border-border rounded-md px-3 py-1.5 pr-9 text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setSecretValueVisible(!secretValueVisible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                {secretValueVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea
              value={secretDescription}
              onChange={(e) => setSecretDescription(e.target.value)}
              rows={3}
              placeholder="Describe when the LLM should use this secret..."
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSecretFormOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveSecret}
              disabled={savingSecret || !secretName.trim() || (!editingSecret && !secretValue)}
            >
              {savingSecret ? "Saving..." : editingSecret ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
