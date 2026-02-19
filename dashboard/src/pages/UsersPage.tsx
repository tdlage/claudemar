import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, X, Save, Copy, Check } from "lucide-react";
import { api } from "../lib/api";
import type { AgentInfo, ProjectInfo } from "../lib/types";

interface User {
  id: string;
  name: string;
  email: string;
  token: string;
  projects: string[];
  agents: string[];
  createdAt: string;
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToken = (userId: string, token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(userId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const loadUsers = useCallback(() => {
    api.get<User[]>("/users").then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsers();
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
  }, [loadUsers]);

  const handleCreate = async () => {
    if (!newName.trim() || !newEmail.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/users", { name: newName.trim(), email: newEmail.trim() });
      setCreating(false);
      setNewName("");
      setNewEmail("");
      loadUsers();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/users/${id}`);
      if (selectedId === id) {
        setSelectedId(null);
        setEditing(null);
      }
      loadUsers();
    } catch {
      // ignore
    }
  };

  const handleSelect = (user: User) => {
    if (selectedId === user.id) {
      setSelectedId(null);
      setEditing(null);
    } else {
      setSelectedId(user.id);
      setEditing({ name: user.name, email: user.email, projects: [...user.projects], agents: [...user.agents] });
    }
  };

  const handleSave = async () => {
    if (!selectedId || !editing || saving) return;
    setSaving(true);
    try {
      await api.put(`/users/${selectedId}`, editing);
      loadUsers();
      setSelectedId(null);
      setEditing(null);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const toggleProject = (projectName: string) => {
    if (!editing) return;
    const current = editing.projects || [];
    const next = current.includes(projectName)
      ? current.filter((p) => p !== projectName)
      : [...current, projectName];
    setEditing({ ...editing, projects: next });
  };

  const toggleAgent = (agentName: string) => {
    if (!editing) return;
    const current = editing.agents || [];
    const next = current.includes(agentName)
      ? current.filter((a) => a !== agentName)
      : [...current, agentName];
    setEditing({ ...editing, agents: next });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Users</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={14} />
          Add User
        </button>
      </div>

      {creating && (
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">New User</span>
            <button onClick={() => { setCreating(false); setNewName(""); setNewEmail(""); }} className="text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              autoFocus
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              className="bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || !newEmail.trim() || saving}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {users.length === 0 && !creating && (
        <div className="text-center py-12 text-text-muted text-sm">
          No users yet. Click "Add User" to create one.
        </div>
      )}

      <div className="space-y-2">
        {users.map((user) => {
          const isSelected = selectedId === user.id;
          return (
            <div key={user.id} className="bg-surface border border-border rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
                onClick={() => handleSelect(user)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{user.name}</span>
                    <span className="text-xs text-text-muted">{user.email}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-text-muted">
                      {user.projects.length} project{user.projects.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-text-muted">
                      {user.agents.length} agent{user.agents.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyToken(user.id, user.token); }}
                      className="flex items-center gap-1 text-xs text-text-muted hover:text-accent transition-colors"
                      title="Copy token"
                    >
                      {copiedId === user.id ? <Check size={10} className="text-success" /> : <Copy size={10} />}
                      {copiedId === user.id ? "Copied!" : "Token"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSelect(user); }}
                    className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(user.id); }}
                    className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {isSelected && editing && (
                <div className="border-t border-border px-4 py-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
                      <input
                        type="text"
                        value={editing.name || ""}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
                      <input
                        type="email"
                        value={editing.email || ""}
                        onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                        className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-2">
                        Projects ({editing.projects?.length || 0}/{projects.length})
                      </label>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {projects.map((p) => (
                          <label
                            key={p.name}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editing.projects?.includes(p.name) || false}
                              onChange={() => toggleProject(p.name)}
                              className="rounded border-border text-accent focus:ring-accent"
                            />
                            <span className="text-sm text-text-primary">{p.name}</span>
                          </label>
                        ))}
                        {projects.length === 0 && (
                          <span className="text-xs text-text-muted">No projects available</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-2">
                        Agents ({editing.agents?.length || 0}/{agents.length})
                      </label>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {agents.map((a) => (
                          <label
                            key={a.name}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editing.agents?.includes(a.name) || false}
                              onChange={() => toggleAgent(a.name)}
                              className="rounded border-border text-accent focus:ring-accent"
                            />
                            <span className="text-sm text-text-primary">{a.name}</span>
                          </label>
                        ))}
                        {agents.length === 0 && (
                          <span className="text-xs text-text-muted">No agents available</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => { setSelectedId(null); setEditing(null); }}
                      className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
                    >
                      <Save size={12} />
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
