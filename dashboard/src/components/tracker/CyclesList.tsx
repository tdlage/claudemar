import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, ArrowLeft, LayoutGrid } from "lucide-react";
import { Badge } from "../shared/Badge";
import { useCycles, useCycleStats, useTrackerProjects } from "../../hooks/useTracker";
import { canEditTrackerProject } from "../../hooks/useAuth";
import { CreateCycleModal } from "./CreateCycleModal";
import { CYCLE_STATUS_VARIANT } from "./constants";

interface Props {
  projectId: string;
}

export function CyclesList({ projectId }: Props) {
  const { cycles, loading } = useCycles(projectId);
  const { stats } = useCycleStats(projectId);
  const { projects } = useTrackerProjects();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const canEdit = canEditTrackerProject(projectId);

  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/tracker" className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold text-text-primary">{project?.name ?? "Project"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/tracker/${projectId}/board`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-accent text-accent hover:bg-accent/10 transition-colors"
          >
            <LayoutGrid size={14} /> Board
          </Link>
          {canEdit && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <Plus size={14} /> New Cycle
            </button>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-text-muted">Loading...</p>}

      {!loading && cycles.length === 0 && (
        <p className="text-sm text-text-muted">No cycles yet.</p>
      )}

      <div className="grid gap-3">
        {cycles.map((cycle) => {
          const cycleStat = stats[cycle.id];
          const columns = [...cycle.columns].sort((a, b) => a.position - b.position);
          const lastColumn = columns[columns.length - 1];
          const completed = lastColumn && cycleStat ? (cycleStat.byColumn[lastColumn.id] ?? 0) : 0;
          const total = cycleStat?.total ?? 0;
          const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

          return (
            <div
              key={cycle.id}
              onClick={() => navigate(`/tracker/${projectId}/cycles/${cycle.id}`)}
              className="bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-accent/40 transition-colors space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{cycle.name}</span>
                  <Badge variant={cycle.type === "bugs" ? "danger" : "info"}>
                    {cycle.type === "bugs" ? "Bugs" : "Features"}
                  </Badge>
                  <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>{cycle.status}</Badge>
                </div>
                <span className="text-xs text-text-muted">
                  {new Date(cycle.createdAt).toLocaleDateString()}
                </span>
              </div>

              {total > 0 && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {columns.map((col) => {
                      const count = cycleStat?.byColumn[col.id] ?? 0;
                      if (count === 0) return null;
                      return (
                        <span
                          key={col.id}
                          className="inline-flex items-center gap-1 text-[11px] text-text-muted"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                          {count} {col.name}
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-success transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-text-muted shrink-0">
                      {completed}/{total}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <CreateCycleModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
    </div>
  );
}
