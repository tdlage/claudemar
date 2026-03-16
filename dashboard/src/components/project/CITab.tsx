import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  RotateCcw,
  Ban,
  ExternalLink,
  RefreshCw,
  Filter,
  GitBranch,
} from "lucide-react";
import { api } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import type {
  RepoInfo,
  CIWorkflow,
  CIWorkflowRun,
  CIWorkflowRunJob,
  CIWebhookEvent,
} from "../../lib/types";

interface CITabProps {
  projectName: string;
  repos: RepoInfo[];
  initialRepo?: string;
}

function conclusionVariant(conclusion: string | null, status: string): "success" | "danger" | "warning" | "default" | "info" {
  if (status === "in_progress" || status === "queued" || status === "waiting") return "warning";
  if (conclusion === "success") return "success";
  if (conclusion === "failure" || conclusion === "timed_out") return "danger";
  if (conclusion === "cancelled" || conclusion === "skipped") return "default";
  return "info";
}

function StatusIcon({ conclusion, status }: { conclusion: string | null; status: string }) {
  if (status === "in_progress") return <Loader2 size={14} className="animate-spin text-warning" />;
  if (status === "queued" || status === "waiting") return <Clock size={14} className="text-warning" />;
  if (conclusion === "success") return <CheckCircle size={14} className="text-success" />;
  if (conclusion === "failure" || conclusion === "timed_out") return <XCircle size={14} className="text-danger" />;
  if (conclusion === "cancelled") return <Ban size={14} className="text-text-muted" />;
  return <Clock size={14} className="text-text-muted" />;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function duration(start: string, end: string | null): string {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

export function CITab({ projectName, repos, initialRepo }: CITabProps) {
  const { addToast } = useToast();
  const githubRepos = repos.filter((r) => r.remoteUrl.includes("github.com"));
  const defaultRepo = initialRepo && githubRepos.some((r) => r.name === initialRepo) ? initialRepo : githubRepos[0]?.name ?? "";
  const [selectedRepo, setSelectedRepo] = useState<string>(defaultRepo);
  const [workflows, setWorkflows] = useState<CIWorkflow[]>([]);
  const [runs, setRuns] = useState<CIWorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterWorkflow, setFilterWorkflow] = useState<number | undefined>();
  const [filterBranch, setFilterBranch] = useState("");

  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [jobs, setJobs] = useState<Record<number, CIWorkflowRunJob[]>>({});
  const [loadingJobs, setLoadingJobs] = useState<number | null>(null);

  const [logsModal, setLogsModal] = useState<{ runId: number; jobName?: string } | null>(null);
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [dispatchModal, setDispatchModal] = useState(false);
  const [dispatchWorkflowId, setDispatchWorkflowId] = useState("");
  const [dispatchRef, setDispatchRef] = useState("");
  const [dispatching, setDispatching] = useState(false);

  const loadWorkflows = useCallback(async (repoName: string) => {
    try {
      const data = await api.get<CIWorkflow[]>(`/projects/${projectName}/repos/${repoName}/ci/workflows`);
      setWorkflows(data);
    } catch {
      setWorkflows([]);
    }
  }, [projectName]);

  const loadRuns = useCallback(async (repoName: string, workflowId?: number, branch?: string) => {
    setLoading(true);
    try {
      let url = `/projects/${projectName}/repos/${repoName}/ci/runs`;
      const params: string[] = [];
      if (workflowId) params.push(`workflowId=${workflowId}`);
      if (branch) params.push(`branch=${encodeURIComponent(branch)}`);
      if (params.length > 0) url += `?${params.join("&")}`;

      const data = await api.get<CIWorkflowRun[]>(url);
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    if (!selectedRepo) return;
    loadWorkflows(selectedRepo);
    loadRuns(selectedRepo, filterWorkflow, filterBranch || undefined);
  }, [selectedRepo, loadWorkflows, loadRuns, filterWorkflow, filterBranch]);

  useEffect(() => {
    const socket = getSocket();
    const currentRepo = repos.find((r) => r.name === selectedRepo);
    if (!currentRepo) return;

    const ownerRepoMatch = currentRepo.remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
    const currentFullName = ownerRepoMatch?.[1] ?? "";

    const onWorkflowRun = (data: CIWebhookEvent) => {
      if (!currentFullName || data.repoFullName !== currentFullName) return;

      if (data.action === "completed") {
        loadRuns(selectedRepo, filterWorkflow, filterBranch || undefined);

        if (data.conclusion === "failure" || data.conclusion === "timed_out") {
          addToast("error", `CI Failed: ${data.name} #${data.runNumber} (${data.headBranch})`);
        } else if (data.conclusion === "success") {
          addToast("success", `CI Passed: ${data.name} #${data.runNumber} (${data.headBranch})`);
        }
      } else if (data.action === "requested" || data.action === "in_progress") {
        loadRuns(selectedRepo, filterWorkflow, filterBranch || undefined);
      }
    };

    socket.on("ci:workflow_run", onWorkflowRun);
    return () => { socket.off("ci:workflow_run", onWorkflowRun); };
  }, [selectedRepo, repos, filterWorkflow, filterBranch, loadRuns, addToast]);

  const handleRefresh = () => {
    if (!selectedRepo) return;
    setExpandedRun(null);
    setJobs({});
    loadRuns(selectedRepo, filterWorkflow, filterBranch || undefined);
  };

  const handleExpandRun = async (runId: number) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(runId);
    if (!jobs[runId]) {
      setLoadingJobs(runId);
      try {
        const data = await api.get<CIWorkflowRunJob[]>(
          `/projects/${projectName}/repos/${selectedRepo}/ci/runs/${runId}/jobs`,
        );
        setJobs((prev) => ({ ...prev, [runId]: data }));
      } catch {
        addToast("error", "Failed to load jobs");
      } finally {
        setLoadingJobs(null);
      }
    }
  };

  const handleViewLogs = async (runId: number, jobName?: string) => {
    setLogsModal({ runId, jobName });
    setLogs("");
    setLoadingLogs(true);
    try {
      const data = await api.get<{ logs: string }>(
        `/projects/${projectName}/repos/${selectedRepo}/ci/runs/${runId}/logs${jobName ? `?job=${encodeURIComponent(jobName)}` : ""}`,
      );
      setLogs(data.logs);
    } catch {
      setLogs("Failed to load logs");
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleRerun = async (runId: number, failedOnly = false) => {
    try {
      await api.post(`/projects/${projectName}/repos/${selectedRepo}/ci/runs/${runId}/rerun`, { failedOnly });
      addToast("success", failedOnly ? "Re-running failed jobs" : "Re-running workflow");
      setTimeout(handleRefresh, 2000);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to rerun");
    }
  };

  const handleCancel = async (runId: number) => {
    try {
      await api.post(`/projects/${projectName}/repos/${selectedRepo}/ci/runs/${runId}/cancel`);
      addToast("success", "Workflow cancelled");
      setTimeout(handleRefresh, 1000);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to cancel");
    }
  };

  const handleDispatch = async () => {
    if (!dispatchWorkflowId || !dispatchRef) return;
    setDispatching(true);
    try {
      await api.post(`/projects/${projectName}/repos/${selectedRepo}/ci/dispatch`, {
        workflowId: dispatchWorkflowId,
        ref: dispatchRef,
      });
      addToast("success", "Workflow dispatched");
      setDispatchModal(false);
      setDispatchWorkflowId("");
      setDispatchRef("");
      setTimeout(handleRefresh, 3000);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to dispatch");
    } finally {
      setDispatching(false);
    }
  };

  if (githubRepos.length === 0) {
    return (
      <p className="text-sm text-text-muted py-8 text-center">
        No GitHub repositories found in this project.
      </p>
    );
  }

  const currentRepo = repos.find((r) => r.name === selectedRepo);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedRepo}
            onChange={(e) => {
              setSelectedRepo(e.target.value);
              setExpandedRun(null);
              setJobs({});
              setFilterWorkflow(undefined);
              setFilterBranch("");
            }}
            className="text-sm bg-surface border border-border rounded-md px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent"
          >
            {githubRepos.map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>

          {workflows.length > 0 && (
            <div className="flex items-center gap-1">
              <Filter size={13} className="text-text-muted" />
              <select
                value={filterWorkflow ?? ""}
                onChange={(e) => setFilterWorkflow(e.target.value ? Number(e.target.value) : undefined)}
                className="text-xs bg-transparent border border-border rounded-md px-1 py-1.5 text-text-muted focus:outline-none focus:border-accent"
              >
                <option value="">All workflows</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1">
            <GitBranch size={13} className="text-text-muted" />
            <input
              type="text"
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              placeholder="Branch filter"
              className="text-xs bg-transparent border border-border rounded-md px-2 py-1.5 text-text-muted placeholder:text-text-muted/50 focus:outline-none focus:border-accent w-28"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={loading}>
            <RefreshCw size={13} className={`mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {workflows.length > 0 && (
            <Button
              size="sm"
              onClick={() => {
                setDispatchRef(currentRepo?.branch || "main");
                setDispatchWorkflowId(String(workflows[0]?.id ?? ""));
                setDispatchModal(true);
              }}
            >
              <Play size={13} className="mr-1" />
              Run Workflow
            </Button>
          )}
        </div>
      </div>

      {loading && runs.length === 0 && (
        <div className="flex items-center justify-center py-8 text-text-muted">
          <Loader2 size={16} className="animate-spin mr-2" />
          Loading...
        </div>
      )}

      {!loading && runs.length === 0 && (
        <p className="text-sm text-text-muted py-8 text-center">
          No workflow runs found.
        </p>
      )}

      {runs.map((run) => {
        const isExpanded = expandedRun === run.id;
        const runJobs = jobs[run.id];
        const isActive = run.status === "in_progress" || run.status === "queued" || run.status === "waiting";

        return (
          <Card key={run.id} className="p-0 overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
              onClick={() => handleExpandRun(run.id)}
            >
              {isExpanded
                ? <ChevronDown size={14} className="text-text-muted shrink-0" />
                : <ChevronRight size={14} className="text-text-muted shrink-0" />
              }
              <StatusIcon conclusion={run.conclusion} status={run.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-text-primary truncate">
                    {run.displayTitle}
                  </span>
                  <Badge variant={conclusionVariant(run.conclusion, run.status)}>
                    {run.conclusion || run.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-text-muted">{run.name}</span>
                  <span className="text-xs text-text-muted">#{run.runNumber}</span>
                  <span className="text-xs text-text-muted">{run.headBranch}</span>
                  <span className="text-xs text-text-muted">{run.event}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-text-muted">{timeAgo(run.createdAt)}</div>
                <div className="text-xs text-text-muted">{run.actor}</div>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border px-4 py-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {isActive && (
                    <Button size="sm" variant="danger" onClick={() => handleCancel(run.id)}>
                      <Ban size={13} className="mr-1" /> Cancel
                    </Button>
                  )}
                  {!isActive && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => handleRerun(run.id)}>
                        <RotateCcw size={13} className="mr-1" /> Re-run All
                      </Button>
                      {run.conclusion === "failure" && (
                        <Button size="sm" variant="secondary" onClick={() => handleRerun(run.id, true)}>
                          <RotateCcw size={13} className="mr-1" /> Re-run Failed
                        </Button>
                      )}
                    </>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => handleViewLogs(run.id)}>
                    View Logs
                  </Button>
                  <a
                    href={run.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-surface hover:bg-surface-hover border border-border text-text-primary transition-colors"
                  >
                    <ExternalLink size={13} /> GitHub
                  </a>
                </div>

                {loadingJobs === run.id && (
                  <div className="flex items-center text-text-muted text-xs">
                    <Loader2 size={12} className="animate-spin mr-1" /> Loading jobs...
                  </div>
                )}

                {runJobs && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-medium text-text-muted">Jobs</h4>
                    {runJobs.map((job) => (
                      <div key={job.id} className="bg-background rounded-md border border-border p-2.5">
                        <div className="flex items-center gap-2">
                          <StatusIcon conclusion={job.conclusion} status={job.status} />
                          <span className="text-sm font-medium text-text-primary flex-1">{job.name}</span>
                          <span className="text-xs text-text-muted">
                            {duration(job.startedAt, job.completedAt)}
                          </span>
                          <button
                            onClick={() => handleViewLogs(run.id, job.name)}
                            className="text-xs text-accent hover:underline"
                          >
                            Logs
                          </button>
                        </div>
                        {job.steps.length > 0 && (
                          <div className="mt-2 pl-6 space-y-0.5">
                            {job.steps.map((step) => (
                              <div key={step.number} className="flex items-center gap-2 text-xs">
                                <StatusIcon conclusion={step.conclusion} status={step.status} />
                                <span className="text-text-secondary">{step.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      <Modal open={dispatchModal} onClose={() => setDispatchModal(false)} title="Run Workflow">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Workflow</label>
            <select
              value={dispatchWorkflowId}
              onChange={(e) => setDispatchWorkflowId(e.target.value)}
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              {workflows.map((w) => (
                <option key={w.id} value={String(w.id)}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Branch / Tag</label>
            <input
              type="text"
              value={dispatchRef}
              onChange={(e) => setDispatchRef(e.target.value)}
              placeholder="main"
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setDispatchModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleDispatch} disabled={!dispatchWorkflowId || !dispatchRef || dispatching}>
              {dispatching ? "Dispatching..." : "Run"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!logsModal} onClose={() => setLogsModal(null)} title={`Logs — Run #${logsModal?.runId ?? ""}`} size="xl">
        {loadingLogs ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading logs...
          </div>
        ) : (
          <pre className="bg-background border border-border rounded-md p-3 text-xs text-text-secondary overflow-auto max-h-[60vh] whitespace-pre-wrap font-mono">
            {logs || "No logs available"}
          </pre>
        )}
      </Modal>
    </div>
  );
}
