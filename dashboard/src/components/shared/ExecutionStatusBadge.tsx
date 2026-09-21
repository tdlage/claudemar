import { Ban, Check, Clock3, CircleX } from "lucide-react";
import { Badge, type Tone } from "../../vendor/dantui";
import type { ExecutionStatus } from "../../lib/types";

const statuses = {
  running: { tone: "warning", icon: Clock3 },
  completed: { tone: "success", icon: Check },
  error: { tone: "danger", icon: CircleX },
  cancelled: { tone: "neutral", icon: Ban },
} satisfies Record<ExecutionStatus, { tone: Tone; icon: typeof Check }>;

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  const { tone, icon: Icon } = statuses[status];
  return (
    <Badge tone={tone} className={`execution-status-badge execution-status-${status}`}>
      <Icon size={13} aria-hidden="true" />
      {status}
    </Badge>
  );
}
