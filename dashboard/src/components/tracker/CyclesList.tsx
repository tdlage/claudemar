import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, ArrowLeft } from "lucide-react";
import { Badge } from "../shared/Badge";
import { useCycles, useTrackerProjects } from "../../hooks/useTracker";
import { isAdmin } from "../../hooks/useAuth";
import { CreateCycleModal } from "./CreateCycleModal";
import { CYCLE_STATUS_VARIANT } from "./constants";

interface Props {
  projectId: string;
}

export function CyclesList({ projectId }: Props) {
  const { cycles, loading } = useCycles(projectId);
  const { projects } = useTrackerProjects();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const admin = isAdmin();

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
        {admin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> New Cycle
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-text-muted">Loading...</p>}

      {!loading && cycles.length === 0 && (
        <p className="text-sm text-text-muted">No cycles yet.</p>
      )}

      <div className="grid gap-3">
        {cycles.map((cycle) => (
          <div
            key={cycle.id}
            onClick={() => navigate(`/tracker/${projectId}/cycles/${cycle.id}`)}
            className="bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-accent/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{cycle.name}</span>
                <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>{cycle.status}</Badge>
              </div>
              <span className="text-xs text-text-muted">
                {new Date(cycle.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      <CreateCycleModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
    </div>
  );
}
