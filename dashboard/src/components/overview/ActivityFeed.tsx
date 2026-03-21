import { useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bot, ChevronDown, Square, User, X } from "lucide-react";
import { Badge } from "../shared/Badge";
import { api } from "../../lib/api";
import { renderOutputHtml } from "../../lib/ansi";
import { MarkdownViewerModal } from "../shared/MarkdownViewerModal";
import type { ExecutionInfo, QueueItem } from "../../lib/types";

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  return `${minutes}m${seconds}s`;
}

const LIMIT_OPTIONS = [20, 50, 100] as const;

interface ActivityFeedProps {
  executions: ExecutionInfo[];
  queue?: QueueItem[];
  expandedId?: string | null;
  onToggle?: (id: string) => void;
  sessionNames?: Record<string, string>;
  sessionIds?: string[];
  sessionFilter?: string;
  onSessionFilterChange?: (filter: string) => void;
  historyLimit?: number;
  onHistoryLimitChange?: (limit: number) => void;
}

export function ActivityFeed({ executions, queue = [], expandedId, onToggle, sessionNames = {}, sessionIds = [], sessionFilter = "__all", onSessionFilterChange, historyLimit = 20, onHistoryLimitChange }: ActivityFeedProps) {
  const [mdViewer, setMdViewer] = useState<{ path: string; base: string } | null>(null);

  const handleOutputClick = useCallback((e: React.MouseEvent, exec: ExecutionInfo) => {
    const target = e.target as HTMLElement;
    const link = target.closest("a[data-md-path]") as HTMLAnchorElement | null;
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    const path = link.getAttribute("data-md-path") ?? "";
    const base = exec.targetType === "orchestrator" ? "orchestrator" : `${exec.targetType}:${exec.targetName}`;
    setMdViewer({ path, base });
  }, []);

  const sorted = [...executions]
    .sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      const dateA = a.completedAt ?? a.startedAt;
      const dateB = b.completedAt ?? b.startedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

  if (executions.length === 0 && queue.length === 0) {
    return <p className="text-sm text-text-muted">No recent activity.</p>;
  }

  return (
    <div className="space-y-1.5">
      {sessionIds.length > 1 && onSessionFilterChange && (
        <div className="flex items-center gap-2 px-3 pb-1">
          <select
            value={sessionFilter}
            onChange={(e) => onSessionFilterChange(e.target.value)}
            className="text-xs font-mono bg-surface border border-border rounded-md px-2 py-1 text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="__all">All sessions</option>
            {sessionIds.map((sid) => (
              <option key={sid} value={sid}>
                {sessionNames[sid] ?? sid.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      )}
      {[...queue].reverse().map((item) => (
        <div key={`q-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md text-sm min-w-0 hover:bg-surface-hover">
          <Badge variant="warning">queued</Badge>
          <span className="text-text-muted text-xs">
            {item.targetName}
          </span>
          {item.username && (
            <span className="inline-flex items-center gap-0.5 text-xs text-text-muted bg-surface-hover rounded px-1 py-0.5">
              <User size={10} />
              {item.username}
            </span>
          )}
          {item.agentName && (
            <span className="inline-flex items-center gap-0.5 text-xs text-accent bg-accent/10 border border-accent/30 rounded px-1 py-0.5">
              <Bot size={10} />
              {item.agentName}
            </span>
          )}
          <span className="text-text-primary truncate flex-1 min-w-0 basis-[120px]">
            {item.prompt}
          </span>
          <span className="text-xs text-text-muted font-mono hidden md:inline" title={item.resumeSessionId ?? "new"}>
            {item.resumeSessionId
              ? (sessionNames[item.resumeSessionId] ?? item.resumeSessionId.slice(0, 8))
              : "New session"}
          </span>
          <span className="text-xs text-text-muted font-mono">
            #{item.seqId}
          </span>
          <span className="text-xs text-text-muted text-right">
            {formatDistanceToNow(new Date(item.enqueuedAt), { addSuffix: true })}
          </span>
          <button
            onClick={() => {
              api.delete(`/executions/queue/${item.seqId}`).catch(() => {});
            }}
            className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger/15 transition-colors shrink-0"
            title="Remove from queue"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {sorted.map((exec) => {
        const statusVariant =
          exec.status === "completed" ? "success" as const :
          exec.status === "error" ? "danger" as const :
          exec.status === "cancelled" ? "warning" as const :
          "default" as const;

        const isExpanded = expandedId === exec.id;
        const clickable = !!onToggle;

        const sanitizedOutput = renderOutputHtml(exec.output || "(sem output)");
        const sessionId = exec.result?.sessionId ?? exec.resumeSessionId;

        return (
          <div key={exec.id}>
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md text-sm min-w-0 ${clickable ? "cursor-pointer" : ""} ${isExpanded ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
              onClick={clickable ? () => onToggle(exec.id) : undefined}
            >
              <Badge variant={statusVariant}>{exec.status}</Badge>
              <span className="text-text-muted text-xs hidden md:inline">
                {exec.targetName}
              </span>
              {exec.username && (
                <span className="inline-flex items-center gap-0.5 text-xs text-text-muted bg-surface-hover rounded px-1 py-0.5">
                  <User size={10} />
                  {exec.username}
                </span>
              )}
              {exec.agentName && (
                <span className="inline-flex items-center gap-0.5 text-xs text-accent bg-accent/10 border border-accent/30 rounded px-1 py-0.5">
                  <Bot size={10} />
                  {exec.agentName}
                </span>
              )}
              <span className="text-text-primary truncate flex-1 min-w-0 basis-[120px]">
                {exec.prompt}
                {exec.status === "error" && exec.error && (
                  <span className="text-danger ml-2">— {exec.error}</span>
                )}
              </span>
              {sessionId && (
                <span className="text-xs text-text-muted font-mono hidden md:inline" title={sessionId}>
                  {sessionNames[sessionId] ?? sessionId.slice(0, 8)}
                </span>
              )}
              {exec.result && (
                <span className="text-xs text-text-muted whitespace-nowrap">
                  {formatDuration(exec.result.durationMs)} · ${exec.result.costUsd.toFixed(2)}
                </span>
              )}
              <span className="text-xs text-text-muted text-right hidden sm:inline">
                {exec.completedAt
                  ? formatDistanceToNow(new Date(exec.completedAt), { addSuffix: true })
                  : "running"}
              </span>
              {exec.status === "running" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    api.post(`/executions/${exec.id}/stop`).catch(() => {});
                  }}
                  className="p-1 rounded text-danger hover:bg-danger/15 transition-colors shrink-0"
                  title="Stop execution"
                >
                  <Square size={12} />
                </button>
              )}
              {clickable && (
                <ChevronDown
                  size={14}
                  className={`text-text-muted transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                />
              )}
            </div>
            {isExpanded && (
              <div className="mx-2 md:mx-3 mt-1 mb-2 space-y-1">
                <pre className="p-2 md:p-3 bg-surface rounded-md border border-border text-xs text-text-secondary max-h-[200px] overflow-auto whitespace-pre-wrap break-words">
                  {exec.prompt}
                </pre>
                {exec.status === "error" && exec.error && (
                  <div className="p-2 bg-danger/10 border border-danger/30 rounded-md text-xs text-danger">
                    {exec.error}
                  </div>
                )}
                <div
                  className="activity-output p-2 md:p-3 bg-bg rounded-md border border-border text-xs text-text-primary max-h-[400px] overflow-auto break-words"
                  dangerouslySetInnerHTML={{ __html: sanitizedOutput }}
                  onClick={(e) => handleOutputClick(e, exec)}
                />
              </div>
            )}
          </div>
        );
      })}

      {onHistoryLimitChange && (
        <div className="flex items-center justify-center gap-2 pt-2 pb-1">
          <span className="text-xs text-text-muted">Show:</span>
          {LIMIT_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => onHistoryLimitChange(n)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                historyLimit === n
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {n}
            </button>
          ))}
          <span className="text-xs text-text-muted">
            ({sorted.length})
          </span>
        </div>
      )}

      {mdViewer && (
        <MarkdownViewerModal
          open
          onClose={() => setMdViewer(null)}
          filePath={mdViewer.path}
          base={mdViewer.base}
        />
      )}
    </div>
  );
}
