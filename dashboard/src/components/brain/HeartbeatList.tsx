import { formatDistanceToNow } from "date-fns";
import { HeartPulse } from "lucide-react";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import type { BrainStatus } from "../../lib/types";

export function HeartbeatList({ status }: { status: BrainStatus }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <HeartPulse size={15} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">Heartbeats</h3>
      </div>
      <div className="space-y-1.5">
        {status.schedulers.map((s) => {
          const stale = s.enabled && !s.disabledReason && !s.lastHeartbeat;
          return (
            <div key={s.name} className="flex items-center gap-2 text-xs">
              <span className="text-text-secondary w-20">{s.name}</span>
              {s.lastHeartbeat ? (
                <span className="text-text-muted flex-1">
                  {formatDistanceToNow(new Date(s.lastHeartbeat), { addSuffix: true })}
                </span>
              ) : (
                <span className="text-text-muted flex-1">—</span>
              )}
              {!s.enabled ? (
                <Badge>desligado</Badge>
              ) : s.disabledReason ? (
                <Badge variant="warning">bloqueado</Badge>
              ) : stale ? (
                <Badge variant="warning">sem sinal</Badge>
              ) : (
                <Badge variant="success">ok</Badge>
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-2 text-xs pt-1 border-t border-border">
          <span className="text-text-secondary w-20">git</span>
          <span className="text-text-muted flex-1 font-mono">{status.git.head || "sem commits"}</span>
          {status.git.dirty > 0 && <Badge>{status.git.dirty} pendente(s)</Badge>}
        </div>
      </div>
    </Card>
  );
}
