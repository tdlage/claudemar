import { useState, useRef } from "react";
import { Plus, Trash2, Pencil, Eye, EyeOff, KeyRound, Upload, FileKey, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import type { AgentSecret, SecretFile } from "../../lib/types";

interface AgentSecretsProps {
  agentName: string;
  secrets: AgentSecret[];
  secretFiles: SecretFile[];
  onRefresh: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentSecrets({ agentName, secrets, secretFiles, onRefresh }: AgentSecretsProps) {
  const { addToast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgentSecret | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [valueVisible, setValueVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingFileDesc, setEditingFileDesc] = useState<string | null>(null);
  const [fileDesc, setFileDesc] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openNew = () => {
    setEditing(null);
    setName("");
    setValue("");
    setDescription("");
    setValueVisible(false);
    setFormOpen(true);
  };

  const openEdit = (secret: AgentSecret) => {
    setEditing(secret);
    setName(secret.name);
    setValue("");
    setDescription(secret.description);
    setValueVisible(false);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/agents/${agentName}/secrets/${editing.id}`, {
          name: name.trim(),
          value: value || undefined,
          description,
        });
        addToast("success", "Secret updated");
      } else {
        if (!value) {
          addToast("error", "Value is required for new secrets");
          setSaving(false);
          return;
        }
        await api.post(`/agents/${agentName}/secrets`, {
          name: name.trim(),
          value,
          description,
        });
        addToast("success", "Secret created");
      }
      setFormOpen(false);
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this secret?")) return;
    try {
      await api.delete(`/agents/${agentName}/secrets/${id}`);
      addToast("success", "Secret deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete secret");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      addToast("error", "File too large (max 10MB)");
      return;
    }

    setUploading(true);
    try {
      const token = localStorage.getItem("dashboard_token") || "";
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/agents/${agentName}/secrets/files`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-Filename": file.name,
        },
        body: buffer,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }

      addToast("success", `File "${file.name}" uploaded`);
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteFile = async (filename: string) => {
    if (!confirm(`Delete file "${filename}"?`)) return;
    try {
      await api.delete(`/agents/${agentName}/secrets/files/${filename}`);
      addToast("success", "File deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete file");
    }
  };

  const handleSaveFileDesc = async (filename: string) => {
    try {
      await api.put(`/agents/${agentName}/secrets/files/${filename}/description`, {
        description: fileDesc,
      });
      addToast("success", "Description updated");
      setEditingFileDesc(null);
      onRefresh();
    } catch {
      addToast("error", "Failed to update description");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">
            Environment Variables ({secrets.length})
          </h3>
          <Button size="sm" variant="secondary" onClick={openNew}>
            <Plus size={12} className="mr-1" /> New
          </Button>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Injected as environment variables during agent execution.
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
                    <Button size="sm" variant="secondary" onClick={() => openEdit(secret)}>
                      <Pencil size={12} />
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(secret.id)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">
            Secret Files ({secretFiles.length})
          </h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <><Loader2 size={12} className="mr-1 animate-spin" /> Uploading...</>
            ) : (
              <><Upload size={12} className="mr-1" /> Upload</>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
        <p className="text-xs text-text-muted mb-3">
          Files available to the agent via absolute path (certificates, auth keys, configs).
        </p>

        {secretFiles.length === 0 ? (
          <p className="text-sm text-text-muted">No secret files uploaded.</p>
        ) : (
          <div className="space-y-2">
            {secretFiles.map((file) => (
              <Card key={file.name} className="py-2 px-4">
                <div className="flex items-center gap-3">
                  <FileKey size={14} className="text-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary font-mono">{file.name}</p>
                    <p className="text-xs text-text-muted">{formatSize(file.size)}</p>
                    {editingFileDesc === file.name ? (
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="text"
                          value={fileDesc}
                          onChange={(e) => setFileDesc(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveFileDesc(file.name);
                            if (e.key === "Escape") setEditingFileDesc(null);
                          }}
                          placeholder="Describe this file..."
                          className="flex-1 bg-bg border border-border rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                          autoFocus
                        />
                        <Button size="sm" variant="secondary" onClick={() => handleSaveFileDesc(file.name)}>
                          Save
                        </Button>
                      </div>
                    ) : (
                      <p
                        className="text-xs text-text-secondary mt-0.5 cursor-pointer hover:text-text-primary transition-colors"
                        onClick={() => { setEditingFileDesc(file.name); setFileDesc(file.description); }}
                      >
                        {file.description || "Click to add description..."}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="danger" onClick={() => handleDeleteFile(file.name)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Secret" : "New Secret"}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="e.g. XPTO_API_KEY"
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Value {editing && <span className="text-text-muted">(leave empty to keep current)</span>}
            </label>
            <div className="relative">
              <input
                type={valueVisible ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={editing ? "Leave empty to keep current value" : "Secret value"}
                className="w-full bg-bg border border-border rounded-md px-3 py-1.5 pr-9 text-sm text-text-primary font-mono focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setValueVisible(!valueVisible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              >
                {valueVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe when the LLM should use this secret..."
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || (!editing && !value)}
            >
              {saving ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
