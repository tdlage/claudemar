import { formatDistanceToNow } from "date-fns";
import { Database, Eye, TriangleAlert } from "lucide-react";
import { Card } from "../shared/Card";
import { useObservedBrain } from "../../hooks/useBrain";
import { BrainStatsRow } from "./BrainStatsRow";
import { BackfillProgressCard } from "./BackfillProgressCard";
import { ConnectorCard } from "./ConnectorCard";
import { HeartbeatList } from "./HeartbeatList";
import { TriageBar } from "./TriageBar";
import { ConnectionIssuesCard } from "./ConnectionIssuesCard";
import type { BrainIndexStatus, BrainStatus } from "../../lib/types";

const CONNECTOR_NAMES = ["gmail", "calendar", "whatsapp", "slack", "claudemar", "ingest", "triage", "compile"] as const;

function InfrastructureCard({ status, index }: { status: BrainStatus; index: BrainIndexStatus | null }) {
  const rows: [string, string][] = [
    ["Fila de eventos", `${status.queues.events} no stream · ${status.queues.eventsPending} sem ack`],
    ["Fila de triagem", String(status.queues.triage)],
    ["Fila de compilação", String(status.queues.compile)],
    ["Quarentena", `${status.quarantineCount} item(ns)`],
    ["Redis", status.redis.reachable ? "acessível" : `inacessível ${status.redis.lastError}`],
  ];
  if (index) {
    rows.push(
      ["Índice T3", index.enabled ? `${index.currentPoints} ponto(s) atuais de ${index.points} · ${index.trackedFiles} página(s)` : "desligado"],
      ["Reconcile noturno", index.lastFull ? formatDistanceToNow(new Date(index.lastFull), { addSuffix: true }) : "nunca"],
    );
  }
  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <Database size={15} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">Infraestrutura</h3>
      </div>
      <div className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="text-text-secondary w-36 shrink-0">{label}</span>
            <span className="text-text-muted flex-1">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** O que o admin vê do brain de outro usuário: saúde, conexões e números — nenhum conteúdo. */
export function ObservedBrainView({ owner }: { owner: string }) {
  const { observed, loading, error, refresh } = useObservedBrain(owner);

  if (loading && !observed) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;
  if (error && !observed) {
    return (
      <div className="py-8 text-center space-y-3">
        <p className="text-sm text-danger">{error}</p>
        <button onClick={refresh} className="text-sm text-accent hover:underline">
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!observed) return null;

  if (!observed.initialized || !observed.status) {
    return (
      <Card className="text-center py-10 space-y-2">
        <p className="text-sm text-text-primary">{observed.name} ainda não abriu o Second Brain.</p>
        <p className="text-xs text-text-muted">O brain é criado na primeira vez que o usuário entra nesta tela.</p>
      </Card>
    );
  }

  const status = observed.status;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-surface border border-border rounded-md px-3 py-2 text-xs text-text-secondary">
        <Eye size={14} className="text-text-muted mt-0.5 shrink-0" />
        <span>
          Visão técnica do brain de <span className="font-medium text-text-primary">{observed.name}</span>: saúde, conexões
          e números. O conteúdo — wiki, dados brutos, buscas, conversas e atividade — fica só com o usuário.
        </span>
      </div>
      <ConnectionIssuesCard issues={status.connections} />
      {status.alerts.length > 0 && (
        <div className="bg-warning/10 border border-warning/30 rounded-md px-3 py-2 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-warning">
            <TriangleAlert size={14} /> Alertas de saúde ({status.alerts.length})
          </div>
          {status.alerts.map((alert) => (
            <p key={alert} className="text-xs text-text-secondary">
              {alert}
            </p>
          ))}
        </div>
      )}
      <BrainStatsRow status={status} />
      {status.backfill.status !== "idle" && <BackfillProgressCard backfill={status.backfill} readOnly />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CONNECTOR_NAMES.map((name) => {
          const scheduler = status.schedulers.find((s) => s.name === name);
          if (!scheduler) return null;
          return (
            <ConnectorCard
              key={name}
              scheduler={scheduler}
              accounts={name === "gmail" || name === "calendar" ? status.google.accounts : []}
              readOnly
            />
          );
        })}
        <HeartbeatList status={status} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TriageBar metrics={status.metrics} />
        <InfrastructureCard status={status} index={observed.index} />
      </div>
    </div>
  );
}
