import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { useBrainActivity, useBrainStatus } from "../../hooks/useBrain";
import { FirstRunCta } from "./FirstRunCta";
import { ConnectorCard } from "./ConnectorCard";
import { BrainStatsRow } from "./BrainStatsRow";
import { TriageBar } from "./TriageBar";
import { HeartbeatList } from "./HeartbeatList";
import { BrainActivityFeed } from "./BrainActivityFeed";
import { BackfillProgressCard } from "./BackfillProgressCard";

export function OverviewTab() {
  const { status, loading, error, refresh } = useBrainStatus();
  const { activity } = useBrainActivity();
  const navigate = useNavigate();

  if (loading && !status) {
    return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;
  }
  if (error && !status) {
    return (
      <div className="py-8 text-center space-y-3">
        <p className="text-sm text-danger">{error}</p>
        <button onClick={refresh} className="text-sm text-accent hover:underline">
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!status) return null;

  const noAccounts = status.google.accounts.length === 0;
  if (noAccounts && status.counts.rawThreads === 0) {
    return <FirstRunCta configured={status.google.configured} />;
  }

  const connectorNames = ["gmail", "calendar", "whatsapp", "slack", "ingest", "triage", "compile"] as const;

  return (
    <div className="space-y-4">
      {status.alerts.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-md px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-warning">
            <TriangleAlert size={14} /> Alertas de saúde ({status.alerts.length})
          </div>
          {status.alerts.slice(0, 5).map((alert, i) => (
            <p key={i} className="text-xs text-text-secondary">
              {alert}
            </p>
          ))}
          {status.alerts.length > 5 && (
            <p className="text-xs text-text-muted">e mais {status.alerts.length - 5}…</p>
          )}
        </div>
      )}
      <BrainStatsRow status={status} />
      {status.backfill.status !== "idle" && <BackfillProgressCard backfill={status.backfill} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {connectorNames.map((name) => {
          const scheduler = status.schedulers.find((s) => s.name === name);
          if (!scheduler) return null;
          return (
            <ConnectorCard
              key={name}
              scheduler={scheduler}
              accounts={name === "gmail" || name === "calendar" ? status.google.accounts : []}
              onChanged={refresh}
            />
          );
        })}
        <HeartbeatList status={status} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TriageBar metrics={status.metrics} />
        <BrainActivityFeed
          activity={activity}
          onOpenPath={(path) => {
            if (path.startsWith("raw/")) navigate(`/second-brain/raw/${path.replace(/^raw\//, "").replace(/\.md$/, "")}`);
            else if (path.startsWith("wiki/")) navigate(`/second-brain/wiki/${path.replace(/^wiki\//, "").replace(/\.md$/, "")}`);
          }}
        />
      </div>
    </div>
  );
}
