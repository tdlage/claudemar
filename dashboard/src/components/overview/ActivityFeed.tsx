import { formatDistanceToNow } from "date-fns";
import { ChevronDown, Square, X } from "lucide-react";
import { Badge } from "../shared/Badge";
import { api } from "../../lib/api";
import type { ExecutionInfo, QueueItem } from "../../lib/types";

interface ActivityFeedProps {
  executions: ExecutionInfo[];
  queue?: QueueItem[];
  expandedId?: string | null;
  onToggle?: (id: string) => void;
}

export function ActivityFeed({ executions, queue = [], expandedId, onToggle }: ActivityFeedProps) {
  const sorted = [...executions]
    .sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      const dateA = a.completedAt ?? a.startedAt;
      const dateB = b.completedAt ?? b.startedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    })
    .slice(0, 20);

  if (sorted.length === 0 && queue.length === 0) {
    return <p className="text-sm text-text-muted">No recent activity.</p>;
  }

  return (
    <div className="space-y-1.5">
      {queue.map((item) => (
        <div key={`q-${item.id}`} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm min-w-0 hover:bg-surface-hover">
          <Badge variant="warning">queued</Badge>
          <span className="text-text-muted text-xs min-w-[70px]">
            {item.targetName}
          </span>
          <span className="text-text-primary truncate flex-1">
            {item.prompt}
          </span>
          <span className="text-xs text-text-muted font-mono">
            #{item.seqId}
          </span>
          <span className="text-xs text-text-muted min-w-[60px] text-right">
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

        return (
          <div key={exec.id}>
            <div
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm min-w-0 ${clickable ? "cursor-pointer" : ""} ${isExpanded ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
              onClick={clickable ? () => onToggle(exec.id) : undefined}
            >
              <Badge variant={statusVariant}>{exec.status}</Badge>
              <span className="text-text-muted text-xs min-w-[70px]">
                {exec.targetName}
              </span>
              <span className="text-text-primary truncate flex-1">
                {exec.prompt}
                {exec.status === "error" && exec.error && (
                  <span className="text-danger ml-2">— {exec.error}</span>
                )}
              </span>
              {exec.result?.sessionId && (
                <span className="text-xs text-text-muted font-mono" title={exec.result.sessionId}>
                  {exec.result.sessionId.slice(0, 8)}
                </span>
              )}
              {exec.result && (
                <span className="text-xs text-text-muted">
                  {(exec.result.durationMs / 1000).toFixed(1)}s · ${exec.result.costUsd.toFixed(2)}
                </span>
              )}
              <span className="text-xs text-text-muted min-w-[60px] text-right">
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
              <div className="mx-3 mt-1 mb-2 space-y-1">
                {exec.status === "error" && exec.error && (
                  <div className="p-2 bg-danger/10 border border-danger/30 rounded-md text-xs text-danger">
                    {exec.error}
                  </div>
                )}
                <pre className="p-3 bg-bg rounded-md border border-border text-xs text-text-primary max-h-[400px] overflow-auto whitespace-pre-wrap break-words">
                  {exec.output || "(sem output)"}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
