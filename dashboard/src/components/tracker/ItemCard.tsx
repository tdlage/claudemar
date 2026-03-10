import { AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import type { TrackerItem } from "../../lib/types";
import { getDaysSpent } from "./constants";

interface Props {
  item: TrackerItem;
  projectCode: string;
  onClick: () => void;
}

function AppetiteBadge({ item }: { item: TrackerItem }) {
  if (!item.startedAt) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-border text-text-muted">
        <Clock size={10} />
        {item.appetite}d
      </span>
    );
  }

  const daysSpent = getDaysSpent(item.startedAt);
  const ratio = daysSpent / item.appetite;
  const pct = Math.min(ratio * 100, 100);

  let colorClass: string;
  if (daysSpent > item.appetite) {
    colorClass = "text-danger bg-danger/10";
  } else if (daysSpent === item.appetite) {
    colorClass = "text-warning bg-warning/10";
  } else {
    colorClass = "text-success bg-success/10";
  }

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${colorClass}`}>
      <span className="relative w-8 h-1.5 rounded-full bg-current/20 overflow-hidden">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-current"
          style={{ width: `${pct}%` }}
        />
      </span>
      {daysSpent}/{item.appetite}d
    </span>
  );
}

function TestStatusBadge({ item }: { item: TrackerItem }) {
  const { testStats } = item;

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

export function ItemCard({ item, projectCode, onClick }: Props) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      className="bg-surface border border-border rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-accent/30 transition-colors"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          {projectCode && item.seqNumber > 0 && (
            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent shrink-0">
              {projectCode}-{item.seqNumber}
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <TestStatusBadge item={item} />
            <AppetiteBadge item={item} />
          </div>
        </div>
        <p className="text-sm font-medium text-text-primary leading-snug">{item.title}</p>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {item.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-border text-text-secondary">{tag}</span>
        ))}
      </div>
      {item.assignees.length > 0 && (
        <div className="flex items-center gap-1 mt-2">
          {item.assignees.map((a) => (
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
