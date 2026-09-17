import { AlertTriangle, CheckCircle2, XCircle, Clock, Bug, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TrackerItem, CycleColumn } from "../../lib/types";
import { useMobile } from "../../hooks/useMobile";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { getDaysSpent, getPriorityConfig, getCycleColor } from "./constants";

interface Props {
  item: TrackerItem;
  projectCode: string;
  onClick: () => void;
  cycleName?: string;
  cycleId?: string;
  onDelete?: (id: string) => void;
  moveColumns?: CycleColumn[];
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

export function ItemCard({ item, projectCode, onClick, cycleName, cycleId, onDelete, moveColumns }: Props) {
  const mobile = useMobile();
  const [moving, setMoving] = useState(false);
  const { addToast } = useToast();
  const move = async (columnId: string) => {
    setMoving(true);
    try { await api.patch(`/tracker/items/${item.id}/move`, { columnId, position: 0 }); }
    catch (error) { addToast("error", error instanceof Error ? error.message : "Não foi possível mover o item."); }
    finally { setMoving(false); }
  };
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable={!mobile}
      onDragStart={handleDragStart}
      onClick={onClick}
      className="tracker-item group bg-surface border border-border rounded-md p-3 md:cursor-grab md:active:cursor-grabbing hover:border-accent/30 transition-colors"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {projectCode && item.seqNumber > 0 && (
            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent shrink-0">
              {projectCode}-{item.seqNumber}
            </span>
          )}
          {item.type === "bug" && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-danger/10 text-danger shrink-0">
              <Bug size={10} />
              Bug
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {(() => {
              const pc = getPriorityConfig(item.priority);
              return pc ? (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${pc.color}`}>
                  {pc.value}
                </span>
              ) : null;
            })()}
            <TestStatusBadge item={item} />
            <AppetiteBadge item={item} />
            {onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); if (confirm("Delete this item?")) onDelete(item.id); }}
                className="text-text-muted hover:text-danger opacity-100 md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                title="Delete item"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }} className="w-full text-left text-sm font-medium text-text-primary leading-snug break-words">{item.title}</button>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {cycleName && (() => {
          const color = cycleId ? getCycleColor(cycleId) : { bg: "var(--color-accent)", text: "#ffffff" };
          return (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              {cycleName}
            </span>
          );
        })()}
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
      {mobile && moveColumns && <label onClick={(event) => event.stopPropagation()} className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-border text-xs text-text-muted">
        Mover para outra etapa
        <select aria-label={`Mover ${item.title}`} disabled={moving} value={item.columnId} onChange={(event) => void move(event.target.value)} className="w-full bg-bg border border-border rounded-lg px-2 text-text-primary">
          {moveColumns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
        </select>
      </label>}
    </div>
  );
}
