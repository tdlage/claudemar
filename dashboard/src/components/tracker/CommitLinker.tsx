import { useState, useEffect } from "react";
import { Link2, Unlink, GitCommitHorizontal } from "lucide-react";
import { Badge } from "../shared/Badge";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { useCommitLinks } from "../../hooks/useTracker";
import type { TrackerScope, GitCommit, RepoInfo } from "../../lib/types";

interface Props {
  scopes: TrackerScope[];
  projectName: string;
}

export function CommitLinker({ scopes, projectName }: Props) {
  const { addToast } = useToast();
  const [selectedScopeId, setSelectedScopeId] = useState<string>(scopes[0]?.id ?? "");
  const { commits, refresh } = useCommitLinks(selectedScopeId || undefined);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [repoCommits, setRepoCommits] = useState<GitCommit[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);

  useEffect(() => {
    if (!projectName) return;
    api
      .get<{ repos: RepoInfo[] }>(`/projects/${projectName}`)
      .then((data) => {
        setRepos(data.repos);
        if (data.repos.length > 0 && !selectedRepo) {
          setSelectedRepo(data.repos[0].name);
        }
      })
      .catch(() => {});
  }, [projectName]);

  useEffect(() => {
    if (!projectName || !selectedRepo) return;
    setLoadingCommits(true);
    api
      .get<GitCommit[]>(`/projects/${projectName}/repos/${selectedRepo}/log`)
      .then(setRepoCommits)
      .catch(() => setRepoCommits([]))
      .finally(() => setLoadingCommits(false));
  }, [projectName, selectedRepo]);

  const handleLink = async (commit: GitCommit) => {
    if (!selectedScopeId) {
      addToast("warning", "Select a scope first");
      return;
    }
    try {
      await api.post("/tracker/commit-links", {
        scopeId: selectedScopeId,
        projectName,
        repoName: selectedRepo,
        commitHash: commit.hash,
        commitMessage: commit.message,
      });
      refresh();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to link commit");
    }
  };

  const handleUnlink = async (id: string) => {
    try {
      await api.delete(`/tracker/commit-links/${id}`);
      refresh();
    } catch {
      addToast("error", "Failed to unlink commit");
    }
  };

  const linkedHashes = new Set(commits.map((c) => c.commitHash));

  if (!projectName) {
    return <p className="text-sm text-text-muted">This bet has no project assigned. Assign a project to link commits.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Scope</label>
          <select
            value={selectedScopeId}
            onChange={(e) => setSelectedScopeId(e.target.value)}
            className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">Select scope</option>
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Repository</label>
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            {repos.map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedScopeId && commits.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Linked Commits</p>
          <div className="space-y-1">
            {commits.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-surface border border-border rounded px-3 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <GitCommitHorizontal size={12} className="text-accent shrink-0" />
                  <code className="text-xs text-accent">{c.commitHash.slice(0, 7)}</code>
                  <span className="text-xs text-text-secondary truncate">{c.commitMessage}</span>
                </div>
                <button onClick={() => handleUnlink(c.id)} className="text-text-muted hover:text-danger shrink-0">
                  <Unlink size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Recent Commits</p>
        {loadingCommits && <p className="text-xs text-text-muted">Loading...</p>}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {repoCommits.map((commit) => {
            const isLinked = linkedHashes.has(commit.hash);
            return (
              <div
                key={commit.hash}
                className={`flex items-center justify-between rounded px-3 py-1.5 ${
                  isLinked ? "bg-accent/5 border border-accent/20" : "bg-surface border border-border"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-xs text-text-muted">{commit.hash.slice(0, 7)}</code>
                  <span className="text-xs text-text-secondary truncate">{commit.message}</span>
                  <span className="text-[10px] text-text-muted shrink-0">{commit.author}</span>
                </div>
                {isLinked ? (
                  <Badge variant="accent">Linked</Badge>
                ) : (
                  <button
                    onClick={() => handleLink(commit)}
                    disabled={!selectedScopeId}
                    className="text-text-muted hover:text-accent disabled:opacity-30 shrink-0"
                    title="Link to scope"
                  >
                    <Link2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {!loadingCommits && repoCommits.length === 0 && (
            <p className="text-xs text-text-muted">No commits found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
