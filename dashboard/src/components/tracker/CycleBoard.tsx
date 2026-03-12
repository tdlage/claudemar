import { useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, ArrowLeft, Trash2, Settings, X } from "lucide-react";
import { Badge } from "../shared/Badge";
import { useItems, useCycles, useTrackerProjects } from "../../hooks/useTracker";
import { canEditTrackerProject } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { ItemCard } from "./ItemCard";
import { CreateItemModal } from "./CreateItemModal";
import { CYCLE_STATUS_VARIANT } from "./constants";
import type { CycleStatus, CycleType, TrackerItem, CycleColumn } from "../../lib/types";

interface Props {
  projectId: string;
  cycleId: string;
}

export function CycleBoard({ projectId, cycleId }: Props) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const canEdit = canEditTrackerProject(projectId);
  const { projects } = useTrackerProjects();
  const { cycles } = useCycles(projectId);
  const { items } = useItems(cycleId);
  const project = projects.find((p) => p.id === projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [showColumnManager, setShowColumnManager] = useState(false);

  const cycle = cycles.find((c) => c.id === cycleId);
  const columns = (cycle?.columns ?? []).sort((a, b) => a.position - b.position);

  const itemsByColumn = useCallback(
    (columnId: string): TrackerItem[] =>
      items.filter((i) => i.columnId === columnId).sort((a, b) => a.position - b.position),
    [items],
  );

  const handleDrop = async (columnId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCol(null);
    const itemId = e.dataTransfer.getData("text/plain");
    if (!itemId) return;
    try {
      await api.patch(`/tracker/items/${itemId}/move`, { columnId, position: 0 });
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to move item");
    }
  };

  const handleCycleStatusChange = async (newStatus: CycleStatus) => {
    try {
      await api.put(`/tracker/cycles/${cycleId}`, { status: newStatus });
    } catch {
      addToast("error", "Failed to update cycle status");
    }
  };

  const handleCycleTypeChange = async (newType: CycleType) => {
    try {
      await api.put(`/tracker/cycles/${cycleId}`, { type: newType });
    } catch {
      addToast("error", "Failed to update cycle type");
    }
  };

  const handleDeleteCycle = async () => {
    if (!confirm("Delete this cycle and all its items?")) return;
    try {
      await api.delete(`/tracker/cycles/${cycleId}`);
      navigate(`/tracker/${projectId}`);
    } catch {
      addToast("error", "Failed to delete cycle");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Link to="/tracker" className="hover:text-text-primary transition-colors">Tracker</Link>
        <span>/</span>
        <Link to={`/tracker/${projectId}`} className="hover:text-text-primary transition-colors">Project</Link>
        <span>/</span>
        <span className="text-text-primary">{cycle?.name ?? "Cycle"}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/tracker/${projectId}`} className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold text-text-primary">{cycle?.name ?? "Cycle"}</h2>
          {cycle && !canEdit && (
            <>
              <Badge variant={cycle.type === "bugs" ? "danger" : "info"}>
                {cycle.type === "bugs" ? "Bugs" : "Features"}
              </Badge>
              <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>{cycle.status}</Badge>
            </>
          )}
          {canEdit && cycle && (
            <>
              <select
                value={cycle.type}
                onChange={(e) => handleCycleTypeChange(e.target.value as CycleType)}
                className="bg-bg border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="features">Features</option>
                <option value="bugs">Bugs</option>
              </select>
              <select
                value={cycle.status}
                onChange={(e) => handleCycleStatusChange(e.target.value as CycleStatus)}
                className="bg-bg border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                {(["active", "completed"] as CycleStatus[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </>
          )}
          {canEdit && (
            <button onClick={() => setShowColumnManager(!showColumnManager)} className="text-text-muted hover:text-text-primary" title="Manage columns">
              <Settings size={14} />
            </button>
          )}
          {canEdit && (
            <button onClick={handleDeleteCycle} className="text-text-muted hover:text-danger">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> New Item
          </button>
        )}
      </div>

      {showColumnManager && canEdit && (
        <ColumnManager cycleId={cycleId} columns={columns} onClose={() => setShowColumnManager(false)} />
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colItems = itemsByColumn(col.id);
          return (
            <div
              key={col.id}
              className={`flex-shrink-0 w-80 bg-surface/50 border-t-2 rounded-lg ${
                dragOverCol === col.id ? "ring-2 ring-accent/30" : ""
              }`}
              style={{ borderTopColor: col.color }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.id);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(col.id, e)}
            >
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  {col.name}
                </span>
                <span className="text-xs text-text-muted">{colItems.length}</span>
              </div>
              <div className="px-2 pb-2 space-y-2 min-h-[100px]">
                {colItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    projectCode={project?.code ?? ""}
                    onClick={() => navigate(`/tracker/${projectId}/cycles/${cycleId}/items/${item.id}`)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CreateItemModal open={createOpen} onClose={() => setCreateOpen(false)} cycleId={cycleId} projectId={projectId} />
    </div>
  );
}

function ColumnManager({ cycleId, columns, onClose }: { cycleId: string; columns: CycleColumn[]; onClose: () => void }) {
  const { addToast } = useToast();
  const [cols, setCols] = useState<CycleColumn[]>(() => columns.map((c) => ({ ...c })));
  const [saving, setSaving] = useState(false);

  const handleAdd = () => {
    const id = crypto.randomUUID();
    setCols([...cols, { id, name: "Nova coluna", color: "#6b7280", position: cols.length }]);
  };

  const handleRemove = (id: string) => {
    setCols(cols.filter((c) => c.id !== id).map((c, i) => ({ ...c, position: i })));
  };

  const handleMove = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= cols.length) return;
    const next = [...cols];
    [next[idx], next[target]] = [next[target], next[idx]];
    setCols(next.map((c, i) => ({ ...c, position: i })));
  };

  const handleUpdate = (id: string, field: "name" | "color", value: string) => {
    setCols(cols.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const handleSave = async () => {
    if (cols.length === 0) { addToast("error", "At least one column is required"); return; }
    setSaving(true);
    try {
      await api.put(`/tracker/cycles/${cycleId}`, { columns: cols });
      addToast("success", "Columns saved");
      onClose();
    } catch {
      addToast("error", "Failed to save columns");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Manage Columns</h3>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={14} /></button>
      </div>
      <div className="space-y-2">
        {cols.map((col, idx) => (
          <div key={col.id} className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => handleMove(idx, -1)}
                disabled={idx === 0}
                className="text-text-muted hover:text-text-primary disabled:opacity-20 text-[10px] leading-none"
              >▲</button>
              <button
                onClick={() => handleMove(idx, 1)}
                disabled={idx === cols.length - 1}
                className="text-text-muted hover:text-text-primary disabled:opacity-20 text-[10px] leading-none"
              >▼</button>
            </div>
            <input
              type="color"
              value={col.color}
              onChange={(e) => handleUpdate(col.id, "color", e.target.value)}
              className="w-6 h-6 rounded border-none cursor-pointer bg-transparent shrink-0"
            />
            <input
              value={col.name}
              onChange={(e) => handleUpdate(col.id, "name", e.target.value)}
              className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <button onClick={() => handleRemove(col.id)} className="text-text-muted hover:text-danger shrink-0">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <button onClick={handleAdd} className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
          <Plus size={12} /> Add Column
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
