import { formatDistanceToNow } from "date-fns";
import { ChevronDown } from "lucide-react";
import { Badge } from "../shared/Badge";
import type { ExecutionInfo } from "../../lib/types";

interface ActivityFeedProps {
  executions: ExecutionInfo[];
  expandedId?: string | null;
  onToggle?: (id: string) => void;
}

export function ActivityFeed({ executions, expandedId, onToggle }: ActivityFeedProps) {
  const sorted = [...executions].reverse().slice(0, 20);

  if (sorted.length === 0) {
    return <p className="text-sm text-text-muted">No recent activity.</p>;
  }

  return (
    <div className="space-y-1.5">
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
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${clickable ? "cursor-pointer" : ""} ${isExpanded ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
              onClick={clickable ? () => onToggle(exec.id) : undefined}
            >
              <Badge variant={statusVariant}>{exec.status}</Badge>
              <span className="text-text-muted text-xs min-w-[70px]">
                {exec.targetName}
              </span>
              <span className="text-text-primary truncate flex-1">{exec.prompt}</span>
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
              {clickable && (
                <ChevronDown
                  size={14}
                  className={`text-text-muted transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                />
              )}
            </div>
            {isExpanded && (
              <pre className="mx-3 mt-1 mb-2 p-3 bg-bg rounded-md border border-border text-xs text-text-primary max-h-[400px] overflow-auto whitespace-pre-wrap break-words">
                {exec.output || exec.error || "(sem output)"}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
