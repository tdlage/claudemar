import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "../shared/Badge";
import type { TrackerBet } from "../../lib/types";

interface Props {
  bet: TrackerBet;
  projectCode: string;
  onClick: () => void;
}

function TestStatusBadge({ bet }: { bet: TrackerBet }) {
  const { testStats } = bet;

  if (testStats.total === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning" title="No tests registered">
        <AlertTriangle size={10} />
      </span>
    );
  }

  if (testStats.failed > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger/10 text-danger" title={`${testStats.failed} test(s) failing`}>
        <XCircle size={10} />
        {testStats.failed}
      </span>
    );
  }

  if (testStats.noRuns > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning" title={`${testStats.noRuns} test(s) not executed`}>
        <AlertTriangle size={10} />
        {testStats.noRuns}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/10 text-success" title="All tests passing">
      <CheckCircle2 size={10} />
    </span>
  );
}

export function BetCard({ bet, projectCode, onClick }: Props) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", bet.id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      className="bg-surface border border-border rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-accent/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {projectCode && bet.seqNumber > 0 && (
            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent shrink-0">
              {projectCode}-{bet.seqNumber}
            </span>
          )}
          <span className="text-sm font-medium text-text-primary leading-tight truncate">{bet.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <TestStatusBadge bet={bet} />
          <Badge variant={bet.appetite === "big" ? "warning" : "default"}>
            {bet.appetite}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {bet.tags.map((tag) => (
          <Badge key={tag} variant="default">{tag}</Badge>
        ))}
      </div>
      {bet.assignees.length > 0 && (
        <div className="flex items-center gap-1 mt-2">
          {bet.assignees.map((a) => (
            <span
              key={a}
              className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] flex items-center justify-center font-medium"
              title={a}
            >
              {a.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
