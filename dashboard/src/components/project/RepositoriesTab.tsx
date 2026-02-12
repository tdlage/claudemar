import { useState, useEffect, useCallback } from "react";
import { GitBranch, GitPullRequest, GitCommitHorizontal, Download, Archive, Trash2, Plus, ChevronDown, ChevronRight, Loader2, CheckCircle, XCircle, FileDiff } from "lucide-react";
import { api } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitLog } from "./GitLog";
import { useToast } from "../shared/Toast";
import type { RepoInfo, RepoBranches, GitCommit, ExecutionInfo } from "../../lib/types";

interface RepositoriesTabProps {
  projectName: string;
  repos: RepoInfo[];
  onRefresh: () => void;
}

type CommitPushStatus = "running" | "completed" | "error";

interface CommitPushState {
  execId: string;
  status: CommitPushStatus;
  error?: string;
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
  const [diffRepo, setDiffRepo] = useState<string | null>(null);

  const [commitPush, setCommitPush] = useState<Record<string, CommitPushState>>({});

  const handleCommitPushDone = useCallback((repoName: string, status: "completed" | "error", error?: string) => {
    setCommitPush((prev) => ({
      ...prev,
      [repoName]: { ...prev[repoName], status, error },
    }));
    if (status === "completed") {
      addToast("success", `Commit & Push completed (${repoName})`);
      onRefresh();
      if (expandedRepo === repoName) {
        Promise.all([
          api.get<RepoBranches>(`/projects/${projectName}/repos/${repoName}/branches`).catch(() => null),
          api.get<GitCommit[]>(`/projects/${projectName}/repos/${repoName}/log`).catch(() => null),
        ]).then(([b, l]) => {
          if (b) setBranches((prev) => ({ ...prev, [repoName]: b }));
          if (l) setLogs((prev) => ({ ...prev, [repoName]: l }));
        });
      }
    } else {
      addToast("error", `Commit & Push failed (${repoName})`);
    }
    setTimeout(() => {
      setCommitPush((prev) => {
        const next = { ...prev };
        delete next[repoName];
        return next;
      });
    }, 5000);
  }, [addToast, expandedRepo, onRefresh, projectName]);

  useEffect(() => {
    const socket = getSocket();
    const runningEntries = Object.entries(commitPush).filter(([, s]) => s.status === "running");
    if (runningEntries.length === 0) return;

    const execToRepo = new Map<string, string>();
    for (const [repoName, state] of runningEntries) {
      execToRepo.set(state.execId, repoName);
      socket.emit("subscribe:execution", state.execId);
    }

    const onComplete = (data: { id: string; info: ExecutionInfo }) => {
      const repoName = execToRepo.get(data.id);
      if (repoName) handleCommitPushDone(repoName, "completed");
    };
    const onError = (data: { id: string; info: ExecutionInfo; error?: string }) => {
      const repoName = execToRepo.get(data.id);
      if (repoName) handleCommitPushDone(repoName, "error", data.error);
    };
    const onCancel = (data: { id: string; info: ExecutionInfo }) => {
      const repoName = execToRepo.get(data.id);
      if (repoName) handleCommitPushDone(repoName, "error", "Cancelled");
    };

    socket.on("execution:complete", onComplete);
    socket.on("execution:error", onError);
    socket.on("execution:cancel", onCancel);

    return () => {
      socket.off("execution:complete", onComplete);
      socket.off("execution:error", onError);
      socket.off("execution:cancel", onCancel);
      for (const execId of execToRepo.keys()) {
        socket.emit("unsubscribe:execution", execId);
      }
    };
  }, [commitPush, handleCommitPushDone]);

  const handleCommitPush = async (repoName: string) => {
    try {
      const { id } = await api.post<{ id: string }>(
        `/projects/${projectName}/repos/${repoName}/commit-push`,
      );
      setCommitPush((prev) => ({
        ...prev,
        [repoName]: { execId: id, status: "running" },
      }));
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to start commit & push");
    }
  };

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
        const cpState = commitPush[repo.name];

        return (
          <Card key={repo.name} className="p-0 overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
              onClick={() => toggleExpand(repo.name)}
            >
              {isExpanded ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
              <span className="font-medium text-sm text-text-primary">{repo.name}</span>
              <Badge variant="accent">{repo.branch || "no branch"}</Badge>
              {cpState?.status === "running" && (
                <Loader2 size={12} className="animate-spin text-accent shrink-0" />
              )}
              {cpState?.status === "completed" && (
                <CheckCircle size={12} className="text-green-500 shrink-0" />
              )}
              {cpState?.status === "error" && (
                <XCircle size={12} className="text-red-500 shrink-0" />
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
                  {repo.hasChanges && (
                    <Button
                      size="sm"
                      variant={diffRepo === repo.name ? "primary" : "secondary"}
                      onClick={() => setDiffRepo(diffRepo === repo.name ? null : repo.name)}
                    >
                      <FileDiff size={13} className="mr-1" />
                      Changes
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleCommitPush(repo.name)}
                    disabled={cpState?.status === "running"}
                  >
                    {cpState?.status === "running" ? (
                      <Loader2 size={13} className="mr-1 animate-spin" />
                    ) : (
                      <GitCommitHorizontal size={13} className="mr-1" />
                    )}
                    {cpState?.status === "running" ? "Committing..." : "Commit & Push"}
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

                {diffRepo === repo.name && (
                  <GitDiffViewer projectName={projectName} repoName={repo.name} />
                )}

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
