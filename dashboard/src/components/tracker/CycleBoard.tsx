import { useState, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Plus, ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Badge } from "../shared/Badge";
import { useBets, useCycles } from "../../hooks/useTracker";
import { isAdmin } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { BetCard } from "./BetCard";
import { CreateBetModal } from "./CreateBetModal";
import { CYCLE_STATUS_VARIANT } from "./constants";
import type { BetStatus, CycleStatus, TrackerBet } from "../../lib/types";

const COLUMNS: { key: BetStatus; label: string; color: string }[] = [
  { key: "pitch", label: "Pitch", color: "border-blue-500/40" },
  { key: "bet", label: "Bet", color: "border-amber-500/40" },
  { key: "in_progress", label: "In Progress", color: "border-accent/40" },
  { key: "done", label: "Done", color: "border-success/40" },
  { key: "dropped", label: "Dropped", color: "border-text-muted/40" },
];

interface Props {
  cycleId: string;
}

export function CycleBoard({ cycleId }: Props) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const admin = isAdmin();
  const { cycles } = useCycles();
  const { bets } = useBets(cycleId);
  const [createOpen, setCreateOpen] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<BetStatus | null>(null);
  const [editingCycle, setEditingCycle] = useState(false);
  const [cycleStatus, setCycleStatus] = useState<CycleStatus | "">("");

  const cycle = cycles.find((c) => c.id === cycleId);

  useEffect(() => {
    if (cycle) setCycleStatus(cycle.status);
  }, [cycle]);

  const betsByStatus = useCallback(
    (status: BetStatus): TrackerBet[] =>
      bets.filter((b) => b.status === status).sort((a, b) => a.position - b.position),
    [bets],
  );

  const handleDrop = async (status: BetStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCol(null);
    const betId = e.dataTransfer.getData("text/plain");
    if (!betId) return;
    try {
      await api.patch(`/tracker/bets/${betId}/move`, { status, position: 0 });
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to move bet");
    }
  };

  const handleCycleStatusChange = async (newStatus: CycleStatus) => {
    setCycleStatus(newStatus);
    try {
      await api.put(`/tracker/cycles/${cycleId}`, { status: newStatus });
    } catch {
      addToast("error", "Failed to update cycle status");
    }
    setEditingCycle(false);
  };

  const handleDeleteCycle = async () => {
    if (!confirm("Delete this cycle and all its bets?")) return;
    try {
      await api.delete(`/tracker/cycles/${cycleId}`);
      navigate("/tracker");
    } catch {
      addToast("error", "Failed to delete cycle");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/tracker" className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold text-text-primary">{cycle?.name ?? "Cycle"}</h2>
          {cycle && !editingCycle && (
            <Badge variant={CYCLE_STATUS_VARIANT[cycle.status]}>{cycle.status}</Badge>
          )}
          {editingCycle && (
            <select
              value={cycleStatus}
              onChange={(e) => handleCycleStatusChange(e.target.value as CycleStatus)}
              className="bg-bg border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              {(["shaping", "betting", "building", "cooldown", "completed"] as CycleStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {admin && !editingCycle && (
            <button onClick={() => setEditingCycle(true)} className="text-text-muted hover:text-text-primary">
              <Pencil size={13} />
            </button>
          )}
          {admin && (
            <button onClick={handleDeleteCycle} className="text-text-muted hover:text-danger">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {admin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> New Bet
          </button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colBets = betsByStatus(col.key);
          return (
            <div
              key={col.key}
              className={`flex-shrink-0 w-64 bg-surface/50 border-t-2 ${col.color} rounded-lg ${
                dragOverCol === col.key ? "ring-2 ring-accent/30" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.key);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(col.key, e)}
            >
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  {col.label}
                </span>
                <span className="text-xs text-text-muted">{colBets.length}</span>
              </div>
              <div className="px-2 pb-2 space-y-2 min-h-[100px]">
                {colBets.map((bet) => (
                  <BetCard
                    key={bet.id}
                    bet={bet}
                    onClick={() => navigate(`/tracker/${cycleId}/bets/${bet.id}`)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <CreateBetModal open={createOpen} onClose={() => setCreateOpen(false)} cycleId={cycleId} />
    </div>
  );
}
