import { formatDistanceToNow } from "date-fns";
import { Badge } from "../shared/Badge";
import type { ExecutionInfo } from "../../lib/types";

interface ActivityFeedProps {
  executions: ExecutionInfo[];
}

export function ActivityFeed({ executions }: ActivityFeedProps) {
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

        return (
          <div key={exec.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-hover text-sm">
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
          </div>
        );
      })}
    </div>
  );
}
