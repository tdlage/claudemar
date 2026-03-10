import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "../shared/Badge";
import { Tabs } from "../shared/Tabs";
import { useBets, useTrackerProjects } from "../../hooks/useTracker";
import { isAdmin } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { TestCasePanel } from "./TestCasePanel";
import { CommentThread } from "./CommentThread";

interface Props {
  projectId: string;
  cycleId: string;
  betId: string;
}

type TabKey = "details" | "tests" | "comments";

export function BetDetail({ projectId, cycleId, betId }: Props) {
  const { addToast } = useToast();
  const admin = isAdmin();
  const { projects } = useTrackerProjects();
  const { bets } = useBets(cycleId);
  const project = projects.find((p) => p.id === projectId);
  const [tab, setTab] = useState<TabKey>("details");
  const [editingBet, setEditingBet] = useState(false);
  const [betTitle, setBetTitle] = useState("");
  const [inScope, setInScope] = useState("");
  const [outOfScope, setOutOfScope] = useState("");

  const bet = bets.find((b) => b.id === betId);

  useEffect(() => {
    if (bet) {
      setInScope(bet.inScope);
      setOutOfScope(bet.outOfScope);
    }
  }, [bet?.inScope, bet?.outOfScope]);

  const handleSaveBetTitle = async () => {
    if (!betTitle.trim()) return;
    try {
      await api.put(`/tracker/bets/${betId}`, { title: betTitle.trim() });
      setEditingBet(false);
    } catch {
      addToast("error", "Failed to update bet");
    }
  };

  const handleSaveInScope = async () => {
    try {
      await api.put(`/tracker/bets/${betId}`, { inScope });
    } catch {
      addToast("error", "Failed to save");
    }
  };

  const handleSaveOutOfScope = async () => {
    try {
      await api.put(`/tracker/bets/${betId}`, { outOfScope });
    } catch {
      addToast("error", "Failed to save");
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "details", label: "Detalhes" },
    { key: "tests", label: "Tests" },
    { key: "comments", label: "Comments" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Link to="/tracker" className="hover:text-text-primary transition-colors">Tracker</Link>
        <span>/</span>
        <Link to={`/tracker/${projectId}`} className="hover:text-text-primary transition-colors">Project</Link>
        <span>/</span>
        <Link to={`/tracker/${projectId}/cycles/${cycleId}`} className="hover:text-text-primary transition-colors">Cycle</Link>
        <span>/</span>
        <span className="text-text-primary">{bet?.title ?? "Bet"}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/tracker/${projectId}/cycles/${cycleId}`} className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          {project && bet && bet.seqNumber > 0 && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent">
              {project.code}-{bet.seqNumber}
            </span>
          )}
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
          {bet && <Badge variant={bet.appetite === "big" ? "warning" : "default"}>{bet.appetite}</Badge>}
          {admin && !editingBet && (
            <button
              onClick={() => { setBetTitle(bet?.title ?? ""); setEditingBet(true); }}
              className="text-text-muted hover:text-text-primary"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
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

      {tab === "details" && (
        <div className="space-y-4">
          {bet?.description && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Descrição</label>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{bet.description}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">In Scope</label>
            <textarea
              value={inScope}
              onChange={(e) => setInScope(e.target.value)}
              onBlur={handleSaveInScope}
              rows={4}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
              placeholder="O que faz parte do escopo deste item..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Out of Scope</label>
            <textarea
              value={outOfScope}
              onChange={(e) => setOutOfScope(e.target.value)}
              onBlur={handleSaveOutOfScope}
              rows={4}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
              placeholder="O que NÃO faz parte do escopo deste item..."
            />
          </div>
        </div>
      )}

      {tab === "tests" && (
        <TestCasePanel targetType="bet" targetId={betId} />
      )}

      {tab === "comments" && (
        <CommentThread targetType="bet" targetId={betId} />
      )}
    </div>
  );
}
