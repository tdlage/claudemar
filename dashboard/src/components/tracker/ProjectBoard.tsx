import { useState, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Bug, Plus } from "lucide-react";
import { useCycles, useTrackerProjects, useProjectBoardItems } from "../../hooks/useTracker";
import { canEditTrackerProject } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { ItemCard } from "./ItemCard";
import { CreateItemModal } from "./CreateItemModal";
import { getCycleColor } from "./constants";
import type { ProjectBoardItem, CycleColumn } from "../../lib/types";

interface Props {
  projectId: string;
}

export function ProjectBoard({ projectId }: Props) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { projects } = useTrackerProjects();
  const { cycles } = useCycles(projectId);
  const [selectedCycleIds, setSelectedCycleIds] = useState<string[]>([]);
  const { items, loading } = useProjectBoardItems(projectId, selectedCycleIds);
  const project = projects.find((p) => p.id === projectId);
  const canEdit = canEditTrackerProject(projectId);
  const [dragOverPos, setDragOverPos] = useState<number | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const toggleCycle = (id: string) => {
    setSelectedCycleIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const relevantCycles = useMemo(() =>
    selectedCycleIds.length > 0
      ? cycles.filter((c) => selectedCycleIds.includes(c.id))
      : cycles,
    [cycles, selectedCycleIds],
  );

  const referenceColumns = useMemo((): CycleColumn[] => {
    const posMap = new Map<number, CycleColumn>();
    for (const cycle of relevantCycles) {
      for (const col of cycle.columns) {
        if (!posMap.has(col.position)) posMap.set(col.position, col);
      }
    }
    return [...posMap.values()].sort((a, b) => a.position - b.position);
  }, [relevantCycles]);

  const positionToColumnIds = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const cycle of relevantCycles) {
      for (const col of cycle.columns) {
        if (!map.has(col.position)) map.set(col.position, new Set());
        map.get(col.position)!.add(col.id);
      }
    }
    return map;
  }, [relevantCycles]);

  const itemsByPosition = useCallback(
    (position: number): ProjectBoardItem[] => {
      const colIds = positionToColumnIds.get(position);
      if (!colIds) return [];
      return items
        .filter((i) => colIds.has(i.columnId))
        .sort((a, b) => a.position - b.position);
    },
    [items, positionToColumnIds],
  );

  const handleDrop = async (position: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverPos(null);
    const itemId = e.dataTransfer.getData("text/plain");
    if (!itemId) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const itemCycle = cycles.find((c) => c.id === item.cycleId);
    if (!itemCycle) return;
    const targetCol = itemCycle.columns.find((c) => c.position === position);
    if (!targetCol) {
      addToast("error", "Coluna não encontrada no cycle deste item");
      return;
    }

    try {
      await api.patch(`/tracker/items/${itemId}/move`, { columnId: targetCol.id, position: 0 });
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to move item");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Link to="/tracker" className="hover:text-text-primary transition-colors">Tracker</Link>
        <span>/</span>
        <Link to={`/tracker/${projectId}`} className="hover:text-text-primary transition-colors">{project?.name ?? "Project"}</Link>
        <span>/</span>
        <span className="text-text-primary">Board</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/tracker/${projectId}`} className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold text-text-primary">{project?.name ?? "Project"} — Board</h2>
        </div>
        {canEdit && (
          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} />
            New Item
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {cycles.map((cycle) => {
          const isSelected = selectedCycleIds.includes(cycle.id);
          const showAll = selectedCycleIds.length === 0;
          const active = isSelected || showAll;
          const color = getCycleColor(cycle.id);
          return (
            <button
              key={cycle.id}
              onClick={() => toggleCycle(cycle.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                active ? "" : "opacity-40 hover:opacity-70"
              }`}
              style={{
                backgroundColor: active ? color.bg : "transparent",
                color: active ? color.text : color.bg,
                border: `1px solid ${color.bg}`,
              }}
            >
              {cycle.type === "bugs" && <Bug size={10} />}
              {cycle.name}
            </button>
          );
        })}
      </div>

      {loading && <p className="text-sm text-text-muted">Loading...</p>}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {referenceColumns.map((col) => {
          const colItems = itemsByPosition(col.position);
          return (
            <div
              key={col.position}
              className={`flex-shrink-0 w-80 bg-surface/50 border-t-2 rounded-lg ${
                dragOverPos === col.position ? "ring-2 ring-accent/30" : ""
              }`}
              style={{ borderTopColor: col.color }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverPos(col.position);
              }}
              onDragLeave={() => setDragOverPos(null)}
              onDrop={(e) => handleDrop(col.position, e)}
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
                    cycleName={item.cycleName}
                    cycleId={item.cycleId}
                    onClick={() => navigate(`/tracker/${projectId}/cycles/${item.cycleId}/items/${item.id}`)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CreateItemModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        projectId={projectId}
        cycles={cycles}
      />
    </div>
  );
}
