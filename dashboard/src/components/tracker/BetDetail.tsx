import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Pencil } from "lucide-react";
import { Badge } from "../shared/Badge";
import { Tabs } from "../shared/Tabs";
import { useBets, useScopes } from "../../hooks/useTracker";
import { isAdmin } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { ScopeCard } from "./ScopeCard";
import { CreateScopeModal } from "./CreateScopeModal";
import { HillChart } from "./HillChart";
import { TestCasePanel } from "./TestCasePanel";
import { CommentThread } from "./CommentThread";
import { CommitLinker } from "./CommitLinker";
import { BET_STATUS_VARIANT } from "./constants";
import type { BetStatus } from "../../lib/types";

interface Props {
  cycleId: string;
  betId: string;
}

type TabKey = "scopes" | "hill" | "tests" | "comments" | "commits";

export function BetDetail({ cycleId, betId }: Props) {
  const { addToast } = useToast();
  const admin = isAdmin();
  const { bets } = useBets(cycleId);
  const { scopes, refresh: refreshScopes } = useScopes(betId);
  const [tab, setTab] = useState<TabKey>("scopes");
  const [createScopeOpen, setCreateScopeOpen] = useState(false);
  const [editingBet, setEditingBet] = useState(false);
  const [betTitle, setBetTitle] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);

  const bet = bets.find((b) => b.id === betId);

  const handleDeleteScope = async (scopeId: string) => {
    try {
      await api.delete(`/tracker/scopes/${scopeId}`);
      addToast("success", "Scope deleted");
    } catch {
      addToast("error", "Failed to delete scope");
    }
  };

  const handleBetStatusChange = async (status: BetStatus) => {
    try {
      await api.put(`/tracker/bets/${betId}`, { status });
    } catch {
      addToast("error", "Failed to update bet");
    }
  };

  const handleSaveBetTitle = async () => {
    if (!betTitle.trim()) return;
    try {
      await api.put(`/tracker/bets/${betId}`, { title: betTitle.trim() });
      setEditingBet(false);
    } catch {
      addToast("error", "Failed to update bet");
    }
  };

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: "scopes", label: "Scopes", badge: scopes.length },
    { key: "hill", label: "Hill Chart" },
    { key: "tests", label: "Tests" },
    { key: "comments", label: "Comments" },
    { key: "commits", label: "Commits" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Link to="/tracker" className="hover:text-text-primary transition-colors">Tracker</Link>
        <span>/</span>
        <Link to={`/tracker/${cycleId}`} className="hover:text-text-primary transition-colors">Cycle</Link>
        <span>/</span>
        <span className="text-text-primary">{bet?.title ?? "Bet"}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/tracker/${cycleId}`} className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          {editingBet ? (
            <input
              value={betTitle}
              onChange={(e) => setBetTitle(e.target.value)}
              onBlur={handleSaveBetTitle}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveBetTitle(); if (e.key === "Escape") setEditingBet(false); }}
              autoFocus
              className="bg-bg border border-border rounded px-2 py-1 text-lg font-semibold text-text-primary focus:outline-none focus:border-accent"
            />
          ) : (
            <h2 className="text-lg font-semibold text-text-primary">{bet?.title ?? "Bet"}</h2>
          )}
          {bet && <Badge variant={BET_STATUS_VARIANT[bet.status]}>{bet.status.replace("_", " ")}</Badge>}
          {bet && <Badge variant={bet.appetite === "big" ? "warning" : "default"}>{bet.appetite}</Badge>}
          {bet?.projectName && <Badge variant="accent">{bet.projectName}</Badge>}
          {admin && !editingBet && (
            <button
              onClick={() => { setBetTitle(bet?.title ?? ""); setEditingBet(true); }}
              className="text-text-muted hover:text-text-primary"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
        {bet && admin && (
          <select
            value={bet.status}
            onChange={(e) => handleBetStatusChange(e.target.value as BetStatus)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            {(["pitch", "bet", "in_progress", "done", "dropped"] as BetStatus[]).map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        )}
      </div>

      {bet?.assignees && bet.assignees.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted mr-1">Assignees:</span>
          {bet.assignees.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-accent/10 text-accent"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "scopes" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => setCreateScopeOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <Plus size={14} /> New Scope
            </button>
          </div>
          {scopes.length === 0 && (
            <p className="text-sm text-text-muted">No scopes yet.</p>
          )}
          <div className="space-y-2">
            {scopes.map((scope) => (
              <ScopeCard
                key={scope.id}
                scope={scope}
                onClick={() => setSelectedScopeId(selectedScopeId === scope.id ? null : scope.id)}
                onDelete={() => handleDeleteScope(scope.id)}
              />
            ))}
          </div>
          <CreateScopeModal open={createScopeOpen} onClose={() => setCreateScopeOpen(false)} betId={betId} />
        </div>
      )}

      {tab === "hill" && (
        <HillChart scopes={scopes} onRefresh={refreshScopes} />
      )}

      {tab === "tests" && (
        <TestCasePanel targetType="bet" targetId={betId} />
      )}

      {tab === "comments" && (
        <CommentThread targetType="bet" targetId={betId} />
      )}

      {tab === "commits" && (
        <CommitLinker scopes={scopes} projectName={bet?.projectName ?? ""} />
      )}
    </div>
  );
}
