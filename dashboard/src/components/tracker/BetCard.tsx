import { Badge } from "../shared/Badge";
import type { TrackerBet } from "../../lib/types";

interface Props {
  bet: TrackerBet;
  onClick: () => void;
}

export function BetCard({ bet, onClick }: Props) {
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
        <span className="text-sm font-medium text-text-primary leading-tight">{bet.title}</span>
        <Badge variant={bet.appetite === "big" ? "warning" : "default"}>
          {bet.appetite}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {bet.projectName && (
          <Badge variant="accent">{bet.projectName}</Badge>
        )}
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
