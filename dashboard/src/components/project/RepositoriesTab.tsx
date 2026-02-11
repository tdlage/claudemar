import { useState } from "react";
import { GitBranch, GitPullRequest, Download, Archive, Trash2, Plus, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { GitLog } from "./GitLog";
import { useToast } from "../shared/Toast";
import type { RepoInfo, RepoBranches, GitCommit } from "../../lib/types";

interface RepositoriesTabProps {
  projectName: string;
  repos: RepoInfo[];
  onRefresh: () => void;
}

export function RepositoriesTab({ projectName, repos, onRefresh }: RepositoriesTabProps) {
  const { addToast } = useToast();
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [branches, setBranches] = useState<Record<string, RepoBranches>>({});
  const [logs, setLogs] = useState<Record<string, GitCommit[]>>({});
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const toggleExpand = async (repoName: string) => {
    if (expandedRepo === repoName) {
      setExpandedRepo(null);
      return;
    }
    setExpandedRepo(repoName);

    if (!branches[repoName]) {
      try {
        const b = await api.get<RepoBranches>(`/projects/${projectName}/repos/${repoName}/branches`);
        setBranches((prev) => ({ ...prev, [repoName]: b }));
      } catch { /* ignore */ }
    }

    if (!logs[repoName]) {
      try {
        const l = await api.get<GitCommit[]>(`/projects/${projectName}/repos/${repoName}/log`);
        setLogs((prev) => ({ ...prev, [repoName]: l }));
      } catch { /* ignore */ }
    }
  };

  const handleClone = async () => {
    if (!cloneUrl.trim()) return;
    setCloning(true);
    try {
      await api.post(`/projects/${projectName}/repos`, {
        url: cloneUrl.trim(),
        name: cloneName.trim() || undefined,
      });
      addToast("success", "Repository cloned");
      setCloneModalOpen(false);
      setCloneUrl("");
      setCloneName("");
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  };

  const handleDelete = async (repoName: string) => {
    try {
      await api.delete(`/projects/${projectName}/repos/${repoName}`);
      addToast("success", `Repository "${repoName}" removed`);
      setDeleteTarget(null);
      setExpandedRepo(null);
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleAction = async (repoName: string, action: string, body?: unknown) => {
    const actionKey = `${repoName}:${action}`;
    setLoadingAction(actionKey);
    try {
      const result = await api.post<{ output: string }>(
        `/projects/${projectName}/repos/${repoName}/${action}`,
        body,
      );
      addToast("success", result.output || `${action} completed`);
      onRefresh();
      if (expandedRepo === repoName) {
        const [b, l] = await Promise.all([
          api.get<RepoBranches>(`/projects/${projectName}/repos/${repoName}/branches`).catch(() => null),
          api.get<GitCommit[]>(`/projects/${projectName}/repos/${repoName}/log`).catch(() => null),
        ]);
        if (b) setBranches((prev) => ({ ...prev, [repoName]: b }));
        if (l) setLogs((prev) => ({ ...prev, [repoName]: l }));
      }
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCheckout = async (repoName: string, branch: string) => {
    await handleAction(repoName, "checkout", { branch });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted">
          Repositories ({repos.length})
        </h2>
        <Button size="sm" onClick={() => setCloneModalOpen(true)}>
          <Plus size={14} className="mr-1" /> Clone
        </Button>
      </div>

      {repos.length === 0 && (
        <p className="text-sm text-text-muted py-8 text-center">
          No repositories found. Clone one to get started.
        </p>
      )}

      {repos.map((repo) => {
        const isExpanded = expandedRepo === repo.name;
        const repoBranches = branches[repo.name];
        const repoLog = logs[repo.name];

        return (
          <Card key={repo.name} className="p-0 overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
              onClick={() => toggleExpand(repo.name)}
            >
              {isExpanded ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
              <span className="font-medium text-sm text-text-primary">{repo.name}</span>
              <Badge variant="accent">{repo.branch || "no branch"}</Badge>
              {repo.hasChanges && (
                <Circle size={8} className="text-warning fill-warning shrink-0" />
              )}
              <span className="flex-1 text-xs text-text-muted truncate text-right">
                {repo.remoteUrl}
              </span>
            </button>

            {isExpanded && (
              <div className="border-t border-border px-4 py-3 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAction(repo.name, "pull")}
                    disabled={loadingAction === `${repo.name}:pull`}
                  >
                    <GitPullRequest size={13} className="mr-1" />
                    {loadingAction === `${repo.name}:pull` ? "Pulling..." : "Pull"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAction(repo.name, "fetch")}
                    disabled={loadingAction === `${repo.name}:fetch`}
                  >
                    <Download size={13} className="mr-1" />
                    {loadingAction === `${repo.name}:fetch` ? "Fetching..." : "Fetch"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAction(repo.name, "stash")}
                    disabled={loadingAction === `${repo.name}:stash`}
                  >
                    <Archive size={13} className="mr-1" />
                    Stash
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAction(repo.name, "stash", { pop: true })}
                    disabled={loadingAction === `${repo.name}:stash`}
                  >
                    <Archive size={13} className="mr-1" />
                    Stash Pop
                  </Button>
                  {repo.name !== "." && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setDeleteTarget(repo.name)}
                    >
                      <Trash2 size={13} className="mr-1" />
                      Remove
                    </Button>
                  )}
                </div>

                {repoBranches && (
                  <div>
                    <h3 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
                      <GitBranch size={12} /> Branches
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {repoBranches.branches.map((b) => (
                        <button
                          key={b}
                          onClick={() => {
                            if (b !== repoBranches.current) handleCheckout(repo.name, b);
                          }}
                          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                            b === repoBranches.current
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border text-text-secondary hover:border-accent hover:text-accent"
                          }`}
                          disabled={b === repoBranches.current || loadingAction === `${repo.name}:checkout`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {repoLog && (
                  <div>
                    <h3 className="text-xs font-medium text-text-muted mb-2">Recent Commits</h3>
                    <GitLog commits={repoLog} />
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      <Modal open={cloneModalOpen} onClose={() => setCloneModalOpen(false)} title="Clone Repository">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Git URL</label>
            <input
              type="text"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Name (optional)</label>
            <input
              type="text"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="Auto-detected from URL"
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setCloneModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleClone} disabled={!cloneUrl.trim() || cloning}>
              {cloning ? "Cloning..." : "Clone"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove Repository">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Are you sure you want to remove <strong className="text-text-primary">{deleteTarget}</strong>?
            This will permanently delete the repository folder.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
