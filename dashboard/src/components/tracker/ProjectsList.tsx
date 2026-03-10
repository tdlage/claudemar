import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useTrackerProjects } from "../../hooks/useTracker";
import { isAdmin } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { Modal } from "../shared/Modal";

export function ProjectsList() {
  const { projects, loading } = useTrackerProjects();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const admin = isAdmin();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleCreate = async () => {
    if (!name.trim() || !code.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/projects", { name: name.trim(), code: code.trim(), description: description.trim() });
      addToast("success", "Project created");
      setName("");
      setCode("");
      setDescription("");
      setCreateOpen(false);
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this project and all its cycles/bets?")) return;
    try {
      await api.delete(`/tracker/projects/${id}`);
      addToast("success", "Project deleted");
    } catch {
      addToast("error", "Failed to delete project");
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await api.put(`/tracker/projects/${id}`, { name: editName.trim() });
      setEditingId(null);
    } catch {
      addToast("error", "Failed to rename project");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Tracker</h2>
        {admin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> New Project
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-text-muted">Loading...</p>}

      {!loading && projects.length === 0 && (
        <p className="text-sm text-text-muted">No projects yet.</p>
      )}

      <div className="grid gap-3">
        {projects.map((project) => (
          <div
            key={project.id}
            onClick={() => navigate(`/tracker/${project.id}`)}
            className="bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-accent/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {editingId === project.id ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(project.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="bg-bg border border-border rounded px-2 py-0.5 text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
                  />
                ) : (
                  <>
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent">{project.code}</span>
                    <span className="font-medium text-text-primary">{project.name}</span>
                  </>
                )}
                {project.description && (
                  <span className="text-xs text-text-muted truncate">{project.description}</span>
                )}
              </div>
              {admin && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditName(project.name); setEditingId(project.id); }}
                    className="text-text-muted hover:text-text-primary"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(project.id, e)}
                    className="text-text-muted hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Project">
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Project name"
                autoFocus
                className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 10))}
                placeholder="CLAU"
                maxLength={10}
                className="w-24 bg-bg border border-border rounded-md px-3 py-1.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent uppercase"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCreateOpen(false)}
              className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || !code.trim() || code.trim().length < 2 || saving}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
