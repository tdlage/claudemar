import { useState, useEffect } from "react";
import { Square, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";
import { api } from "../../lib/api";
import type { ExecutionInfo } from "../../lib/types";

interface ExecutionCardProps {
  execution: ExecutionInfo;
  onViewOutput?: (id: string) => void;
}

export function ExecutionCard({ execution, onViewOutput }: ExecutionCardProps) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (execution.status !== "running") return;
    const interval = setInterval(() => {
      setElapsed(formatDistanceToNow(new Date(execution.startedAt), { includeSeconds: true }));
    }, 1000);
    return () => clearInterval(interval);
  }, [execution.status, execution.startedAt]);

  const handleStop = async () => {
    await api.post(`/executions/${execution.id}/stop`);
  };

  const sourceVariant = execution.source === "telegram" ? "accent" as const : "default" as const;

  return (
    <Card>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant={sourceVariant}>{execution.source}</Badge>
          <Badge>{execution.targetType}:{execution.targetName}</Badge>
          {execution.status === "running" && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              <span className="text-xs text-text-muted">{elapsed}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onViewOutput && (
            <Button size="sm" variant="ghost" onClick={() => onViewOutput(execution.id)}>
              <Eye size={14} />
            </Button>
          )}
          {execution.status === "running" && (
            <Button size="sm" variant="danger" onClick={handleStop}>
              <Square size={14} />
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-text-primary truncate">{execution.prompt}</p>
      {execution.result && (
        <p className="text-xs text-text-muted mt-1">
          {(execution.result.durationMs / 1000).toFixed(1)}s · ${execution.result.costUsd.toFixed(2)}
        </p>
      )}
    </Card>
  );
}
