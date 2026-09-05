import { useState, useEffect, useCallback } from "react";
import { GitBranch, GitPullRequest, GitCommitHorizontal, GitMerge, FolderGit2, Download, Archive, Trash2, Plus, ChevronDown, ChevronRight, Loader2, CheckCircle, XCircle, FileDiff, Circle } from "lucide-react";
import { api } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { GitDiffViewer } from "./GitDiffViewer";
import { GitLog } from "./GitLog";
import { useToast } from "../shared/Toast";
import { TrackerItemSelector } from "./TrackerItemSelector";
import type { RepoInfo, RepoBranches, GitCommit, ExecutionInfo, CIWorkflowRun, WorktreeInfo } from "../../lib/types";

interface CIStatusSummary {
  conclusion: string | null;
  status: string;
  name: string;
  runNumber: number;
  count: number;
}

interface RepositoriesTabProps {
  projectName: string;
  repos: RepoInfo[];
  onRefresh: () => void;
  onNavigateCI?: (repoName: string) => void;
}

type CommitPushStatus = "running" | "completed" | "error";

interface CommitPushState {
  execId: string;
  status: CommitPushStatus;
  error?: string;
}

export function RepositoriesTab({ projectName, repos, onRefresh, onNavigateCI }: RepositoriesTabProps) {
  const { addToast } = useToast();
  const [visibilityPending, setVisibilityPending] = useState(false);
  async function toggleVisibility(repo: RepoInfo) {
    setVisibilityPending(true);
    try {
      await api.put(`/projects/${encodeURIComponent(projectName)}/repos/${encodeURIComponent(repo.name)}/visibility`, { visible: !!repo.hidden });
      setExpandedRepo(null);
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setVisibilityPending(false);
    }
  }

  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [ciStatus, setCiStatus] = useState<Record<string, CIStatusSummary>>({});
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
  const [trackerSelectorTarget, setTrackerSelectorTarget] = useState<string | null>(null);

  const [worktrees, setWorktrees] = useState<Record<string, WorktreeInfo[]>>({});
  const [wtDiff, setWtDiff] = useState<string | null>(null);
  const [wtCreateRepo, setWtCreateRepo] = useState<string | null>(null);
  const [wtBranch, setWtBranch] = useState("");
  const [wtBaseBranch, setWtBaseBranch] = useState("");
  const [wtCreating, setWtCreating] = useState(false);
  const [wtMergeTarget, setWtMergeTarget] = useState<{ repo: string; worktree: WorktreeInfo } | null>(null);
  const [wtMergePush, setWtMergePush] = useState(true);
  const [wtMergeRemove, setWtMergeRemove] = useState(true);
  const [wtMerging, setWtMerging] = useState(false);
  const [wtDeleteTarget, setWtDeleteTarget] = useState<{ repo: string; worktree: WorktreeInfo } | null>(null);
  const [wtDeleteBranch, setWtDeleteBranch] = useState(false);

  const loadWorktrees = useCallback(async (repoName: string) => {
    try {
      const list = await api.get<WorktreeInfo[]>(`/projects/${projectName}/repos/${repoName}/worktrees`);
      setWorktrees((prev) => ({ ...prev, [repoName]: list }));
    } catch { }
  }, [projectName]);

  const handleCommitPushDone = useCallback((targetKey: string, status: "completed" | "error", error?: string) => {
    const [repoName, wtPath] = targetKey.split("@@");
    setCommitPush((prev) => ({
      ...prev,
      [targetKey]: { ...prev[targetKey], status, error },
    }));
    if (status === "completed") {
      addToast("success", `Commit & Push completed (${repoName})`);
      if (wtPath) {
        setWtDiff((prev) => (prev === wtPath ? null : prev));
      } else {
        setDiffRepo((prev) => (prev === repoName ? null : prev));
      }
      onRefresh();
      if (expandedRepo === repoName) {
        Promise.all([
          api.get<RepoBranches>(`/projects/${projectName}/repos/${repoName}/branches`).catch(() => null),
          api.get<GitCommit[]>(`/projects/${projectName}/repos/${repoName}/log`).catch(() => null),
        ]).then(([b, l]) => {
          if (b) setBranches((prev) => ({ ...prev, [repoName]: b }));
          if (l) setLogs((prev) => ({ ...prev, [repoName]: l }));
        });
        loadWorktrees(repoName);
      }
    } else {
      addToast("error", `Commit & Push failed (${repoName})`);
    }
    setTimeout(() => {
      setCommitPush((prev) => {
        const next = { ...prev };
        delete next[targetKey];
        return next;
      });
    }, 5000);
  }, [addToast, expandedRepo, loadWorktrees, onRefresh, projectName]);

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

  useEffect(() => {
    const githubRepos = repos.filter((r) => !r.hidden && r.remoteUrl.includes("github.com"));
    if (githubRepos.length === 0) return;

    for (const repo of githubRepos) {
      api.get<CIWorkflowRun[]>(`/projects/${projectName}/repos/${repo.name}/ci/runs`)
        .then((runs) => {
          if (runs.length === 0) return;
          const latest = runs[0];
          const latestPerWorkflow = new Map<number, CIWorkflowRun>();
          for (const run of runs) {
            if (!latestPerWorkflow.has(run.workflowId)) {
              latestPerWorkflow.set(run.workflowId, run);
            }
          }
          const hasAnyFailure = [...latestPerWorkflow.values()].some(
            (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
          );
          const allSuccess = [...latestPerWorkflow.values()].every(
            (r) => r.conclusion === "success",
          );
          const hasRunning = [...latestPerWorkflow.values()].some(
            (r) => r.status === "in_progress" || r.status === "queued",
          );

          let conclusion: string | null;
          let status: string;
          if (hasRunning) {
            conclusion = null;
            status = "in_progress";
          } else if (hasAnyFailure) {
            conclusion = "failure";
            status = "completed";
          } else if (allSuccess) {
            conclusion = "success";
            status = "completed";
          } else {
            conclusion = latest.conclusion;
            status = latest.status;
          }

          setCiStatus((prev) => ({
            ...prev,
            [repo.name]: {
              conclusion,
              status,
              name: latest.name,
              runNumber: latest.runNumber,
              count: latestPerWorkflow.size,
            },
          }));
        })
        .catch(() => {});
    }
  }, [repos, projectName]);

  const handleCommitPush = async (targetKey: string, trackerItems: string[] = []) => {
    const [repoName, wtPath] = targetKey.split("@@");
    const query = wtPath ? `?worktree=${encodeURIComponent(wtPath)}` : "";
    try {
      const { id } = await api.post<{ id: string }>(
        `/projects/${projectName}/repos/${repoName}/commit-push${query}`,
        { trackerItems },
      );
      setCommitPush((prev) => ({
        ...prev,
        [targetKey]: { execId: id, status: "running" },
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

    const repo = repos.find((r) => r.name === repoName);
    if (repo?.hasChanges) {
      setDiffRepo(repoName);
    } else {
      setDiffRepo((prev) => (prev === repoName ? null : prev));
    }

    loadWorktrees(repoName);

    if (!branches[repoName]) {
      try {
        const b = await api.get<RepoBranches>(`/projects/${projectName}/repos/${repoName}/branches`);
        setBranches((prev) => ({ ...prev, [repoName]: b }));
      } catch { }
    }

    if (!logs[repoName]) {
      try {
        const l = await api.get<GitCommit[]>(`/projects/${projectName}/repos/${repoName}/log`);
        setLogs((prev) => ({ ...prev, [repoName]: l }));
      } catch { }
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

  const handleWorktreeAction = async (repoName: string, worktree: WorktreeInfo, action: string) => {
    const actionKey = `${repoName}:${worktree.path}:${action}`;
    setLoadingAction(actionKey);
    try {
      const result = await api.post<{ output: string }>(
        `/projects/${projectName}/repos/${repoName}/${action}?worktree=${encodeURIComponent(worktree.path)}`,
      );
      addToast("success", result.output || `${action} completed`);
      loadWorktrees(repoName);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCreateWorktree = async () => {
    if (!wtCreateRepo || !wtBranch.trim()) return;
    setWtCreating(true);
    try {
      await api.post(`/projects/${projectName}/repos/${wtCreateRepo}/worktrees`, {
        branch: wtBranch.trim(),
        baseBranch: wtBaseBranch.trim() || undefined,
      });
      addToast("success", `Worktree created (${wtBranch.trim()})`);
      loadWorktrees(wtCreateRepo);
      setWtCreateRepo(null);
      setWtBranch("");
      setWtBaseBranch("");
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to create worktree");
    } finally {
      setWtCreating(false);
    }
  };

  const handleMergeWorktree = async () => {
    if (!wtMergeTarget) return;
    const { repo, worktree } = wtMergeTarget;
    setWtMerging(true);
    try {
      const result = await api.post<{ output: string }>(
        `/projects/${projectName}/repos/${repo}/worktrees/merge`,
        { worktree: worktree.path, push: wtMergePush, remove: wtMergeRemove },
      );
      addToast("success", result.output || "Merge completed");
      setWtMergeTarget(null);
      setWtDiff((prev) => (prev === worktree.path ? null : prev));
      loadWorktrees(repo);
      onRefresh();
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Merge failed");
    } finally {
      setWtMerging(false);
    }
  };

  const handleDeleteWorktree = async () => {
    if (!wtDeleteTarget) return;
    const { repo, worktree } = wtDeleteTarget;
    try {
      await api.delete(
        `/projects/${projectName}/repos/${repo}/worktrees?path=${encodeURIComponent(worktree.path)}&deleteBranch=${wtDeleteBranch}`,
      );
      addToast("success", "Worktree removed");
      setWtDeleteTarget(null);
      setWtDeleteBranch(false);
      setWtDiff((prev) => (prev === worktree.path ? null : prev));
      loadWorktrees(repo);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to remove worktree");
    }
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

      <p className="text-xs text-text-muted">All repositories are available by default. Hidden repositories are moved out of the project folder. This selection survives server restarts.</p>
      {repos.length === 0 && (
        <p className="text-sm text-text-muted py-8 text-center">
          No repositories found. Clone one to get started.
        </p>
      )}

      {repos.map((repo) => {
        const isExpanded = !repo.hidden && expandedRepo === repo.name;
        const repoBranches = branches[repo.name];
        const repoLog = logs[repo.name];
        const cpState = commitPush[repo.name];
        const ci = ciStatus[repo.name];
        const repoWorktrees = (worktrees[repo.name] ?? []).filter((w) => !w.isMain);

        return (
          <Card key={repo.name} className="p-0 overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
              onClick={() => !repo.hidden && toggleExpand(repo.name)}
            >
              {isExpanded ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
              <span className="font-medium text-sm text-text-primary">{repo.name}</span>
              <Badge variant="accent">{repo.branch || "no branch"}</Badge>
              {repo.hasChanges && !cpState && (
                <Circle size={8} className="text-warning fill-warning shrink-0" />
              )}
              {cpState?.status === "running" && (
                <Loader2 size={12} className="animate-spin text-accent shrink-0" />
              )}
              {cpState?.status === "completed" && (
                <CheckCircle size={12} className="text-green-500 shrink-0" />
              )}
              {cpState?.status === "error" && (
                <XCircle size={12} className="text-red-500 shrink-0" />
              )}
              {ci && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateCI?.(repo.name);
                  }}
                  title={ci.count > 1 ? `${ci.count} workflows — latest: ${ci.name} #${ci.runNumber}` : `${ci.name} #${ci.runNumber}`}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${onNavigateCI ? "cursor-pointer hover:opacity-80" : ""} ${
                    ci.status === "in_progress"
                      ? "bg-warning/15 text-warning"
                      : ci.conclusion === "success"
                        ? "bg-success/15 text-success"
                        : ci.conclusion === "failure" || ci.conclusion === "timed_out"
                          ? "bg-danger/15 text-danger"
                          : "bg-border text-text-secondary"
                  }`}
                >
                  {ci.status === "in_progress" ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : ci.conclusion === "success" ? (
                    <CheckCircle size={10} />
                  ) : ci.conclusion === "failure" || ci.conclusion === "timed_out" ? (
                    <XCircle size={10} />
                  ) : null}
                  CI{ci.count > 1 ? ` (${ci.count})` : ""}
                </span>
              )}
              <span className="flex-1 text-xs text-text-muted truncate text-right">
                {repo.remoteUrl}
              </span>
            </button>

            <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border">
              <span className="text-xs text-text-muted">{repo.name === "." ? "Project root — always available" : repo.hidden ? "Hidden from agent workspace" : "Available to agent"}</span>
              <Button size="sm" variant="secondary" disabled={visibilityPending || repo.name === "."} onClick={() => toggleVisibility(repo)}>
                {repo.hidden ? "Make available" : "Hide from agent"}
              </Button>
            </div>
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
                    onClick={() => setTrackerSelectorTarget(repo.name)}
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

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium text-text-muted flex items-center gap-1.5">
                      <FolderGit2 size={12} /> Worktrees ({repoWorktrees.length})
                    </h3>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setWtBranch("");
                        setWtBaseBranch("");
                        setWtCreateRepo(repo.name);
                      }}
                    >
                      <Plus size={13} className="mr-1" /> New Worktree
                    </Button>
                  </div>

                  {repoWorktrees.length === 0 && (
                    <p className="text-xs text-text-muted">
                      No worktrees. Create one to work on a branch in isolation until it is merged.
                    </p>
                  )}

                  <div className="space-y-2">
                    {repoWorktrees.map((wt) => {
                      const wtKey = `${repo.name}@@${wt.path}`;
                      const wtCpState = commitPush[wtKey];
                      const wtLoading = (action: string) => loadingAction === `${repo.name}:${wt.path}:${action}`;

                      return (
                        <div key={wt.path} className="border border-border rounded-md">
                          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                            <GitBranch size={12} className="text-text-muted shrink-0" />
                            <Badge variant="accent">{wt.branch || "detached"}</Badge>
                            {wt.hasChanges && !wtCpState && (
                              <Circle size={8} className="text-warning fill-warning shrink-0" />
                            )}
                            {wtCpState?.status === "running" && (
                              <Loader2 size={12} className="animate-spin text-accent shrink-0" />
                            )}
                            {wtCpState?.status === "completed" && (
                              <CheckCircle size={12} className="text-green-500 shrink-0" />
                            )}
                            {wtCpState?.status === "error" && (
                              <XCircle size={12} className="text-red-500 shrink-0" />
                            )}
                            {(wt.ahead > 0 || wt.behind > 0) && (
                              <span className="text-xs text-text-secondary shrink-0" title={`vs ${wt.baseBranch}`}>
                                ↑{wt.ahead} ↓{wt.behind} vs {wt.baseBranch}
                              </span>
                            )}
                            {wt.prunable && (
                              <Badge variant="warning">prunable</Badge>
                            )}
                            <span className="flex-1 text-xs text-text-muted truncate text-right font-mono" title={wt.path}>
                              {wt.path}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-2 px-3 pb-2">
                            {wt.hasChanges && (
                              <Button
                                size="sm"
                                variant={wtDiff === wt.path ? "primary" : "secondary"}
                                onClick={() => setWtDiff(wtDiff === wt.path ? null : wt.path)}
                              >
                                <FileDiff size={13} className="mr-1" />
                                Changes
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleWorktreeAction(repo.name, wt, "pull")}
                              disabled={wtLoading("pull")}
                            >
                              <GitPullRequest size={13} className="mr-1" />
                              {wtLoading("pull") ? "Pulling..." : "Pull"}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setTrackerSelectorTarget(wtKey)}
                              disabled={wtCpState?.status === "running"}
                            >
                              {wtCpState?.status === "running" ? (
                                <Loader2 size={13} className="mr-1 animate-spin" />
                              ) : (
                                <GitCommitHorizontal size={13} className="mr-1" />
                              )}
                              {wtCpState?.status === "running" ? "Committing..." : "Commit & Push"}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setWtMergePush(true);
                                setWtMergeRemove(true);
                                setWtMergeTarget({ repo: repo.name, worktree: wt });
                              }}
                              disabled={!wt.branch || wtCpState?.status === "running"}
                            >
                              <GitMerge size={13} className="mr-1" />
                              Merge to {wt.baseBranch}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setWtDeleteBranch(false);
                                setWtDeleteTarget({ repo: repo.name, worktree: wt });
                              }}
                            >
                              <Trash2 size={13} className="mr-1" />
                              Remove
                            </Button>
                          </div>

                          {wtDiff === wt.path && (
                            <div className="px-3 pb-3">
                              <GitDiffViewer projectName={projectName} repoName={repo.name} worktree={wt.path} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

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

      <TrackerItemSelector
        open={!!trackerSelectorTarget}
        onClose={() => setTrackerSelectorTarget(null)}
        onConfirm={(items) => {
          if (trackerSelectorTarget) {
            handleCommitPush(trackerSelectorTarget, items);
          }
          setTrackerSelectorTarget(null);
        }}
      />

      <Modal open={!!wtCreateRepo} onClose={() => setWtCreateRepo(null)} title="New Worktree">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Branch</label>
            <input
              type="text"
              value={wtBranch}
              onChange={(e) => setWtBranch(e.target.value)}
              placeholder="feature/my-branch"
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Base branch (optional)</label>
            <input
              type="text"
              value={wtBaseBranch}
              onChange={(e) => setWtBaseBranch(e.target.value)}
              placeholder="Default branch"
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <p className="text-xs text-text-muted">
            Creates an isolated checkout of the branch. Work on it, commit, and merge it back when ready.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setWtCreateRepo(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateWorktree} disabled={!wtBranch.trim() || wtCreating}>
              {wtCreating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!wtMergeTarget} onClose={() => setWtMergeTarget(null)} title="Merge Worktree">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Merge <strong className="text-text-primary">{wtMergeTarget?.worktree.branch}</strong> into{" "}
            <strong className="text-text-primary">{wtMergeTarget?.worktree.baseBranch}</strong>?
          </p>
          {wtMergeTarget?.worktree.hasChanges && (
            <p className="text-xs text-warning">
              This worktree has uncommitted changes. Commit them first, otherwise the merge will be rejected.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={wtMergePush}
              onChange={(e) => setWtMergePush(e.target.checked)}
            />
            Push {wtMergeTarget?.worktree.baseBranch} after merge
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={wtMergeRemove}
              onChange={(e) => setWtMergeRemove(e.target.checked)}
            />
            Remove worktree and delete branch after merge
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setWtMergeTarget(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleMergeWorktree} disabled={wtMerging}>
              {wtMerging ? "Merging..." : "Merge"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!wtDeleteTarget} onClose={() => setWtDeleteTarget(null)} title="Remove Worktree">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Are you sure you want to remove the worktree for{" "}
            <strong className="text-text-primary">{wtDeleteTarget?.worktree.branch || wtDeleteTarget?.worktree.path}</strong>?
            {wtDeleteTarget?.worktree.hasChanges && (
              <span className="text-warning"> It has uncommitted changes that will be lost.</span>
            )}
          </p>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={wtDeleteBranch}
              onChange={(e) => setWtDeleteBranch(e.target.checked)}
            />
            Also delete branch {wtDeleteTarget?.worktree.branch}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setWtDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleDeleteWorktree}>
              Remove
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
