import { useState } from "react";
import { Trash2, GripVertical } from "lucide-react";
import { Badge } from "../shared/Badge";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { TrackerScope, ScopeStatus } from "../../lib/types";

interface Props {
  scope: TrackerScope;
  onClick: () => void;
  onDelete: () => void;
}

const statusOptions: { value: ScopeStatus; label: string; variant: "info" | "warning" | "success" }[] = [
  { value: "uphill", label: "Uphill", variant: "info" },
  { value: "overhill", label: "Over Hill", variant: "warning" },
  { value: "done", label: "Done", variant: "success" },
];

export function ScopeCard({ scope, onClick, onDelete }: Props) {
  const { addToast } = useToast();
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newStatus = e.target.value as ScopeStatus;
    setUpdatingStatus(true);
    try {
      await api.put(`/tracker/scopes/${scope.id}`, { status: newStatus });
    } catch {
      addToast("error", "Failed to update scope");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleHillChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const hillPosition = Number(e.target.value);
    try {
      await api.patch(`/tracker/scopes/${scope.id}/hill`, { hillPosition });
    } catch {
      addToast("error", "Failed to update hill position");
    }
  };

  const currentStatus = statusOptions.find((s) => s.value === scope.status);

  return (
    <div
      onClick={onClick}
      className="bg-surface border border-border rounded-md p-3 cursor-pointer hover:border-accent/30 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="text-text-muted mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{scope.title}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant={currentStatus?.variant ?? "info"}>{currentStatus?.label ?? scope.status}</Badge>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Delete this scope?")) onDelete();
                }}
                className="text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
            <select
              value={scope.status}
              onChange={handleStatusChange}
              disabled={updatingStatus}
              className="bg-bg border border-border rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={100}
              value={scope.hillPosition}
              onChange={handleHillChange}
              className="flex-1 h-1 accent-accent"
            />
            <span className="text-xs text-text-muted w-8 text-right">{scope.hillPosition}%</span>
          </div>
          {scope.assignees.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              {scope.assignees.map((a) => (
                <span
                  key={a}
                  className="w-4 h-4 rounded-full bg-accent/20 text-accent text-[9px] flex items-center justify-center font-medium"
                  title={a}
                >
                  {a.charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
