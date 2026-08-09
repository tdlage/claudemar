import { formatDistanceToNow } from "date-fns";
import { DatabaseBackup } from "lucide-react";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { BackfillState } from "../../lib/types";

const PHASE_LABELS: Record<string, string> = {
  raw: "ingestão bruta",
  triage: "triagem",
  compile: "compilação",
};

export function BackfillProgressCard({ backfill }: { backfill: BackfillState }) {
  const { addToast } = useToast();
  const pct = backfill.progress.total > 0 ? Math.min(100, (backfill.progress.processed / backfill.progress.total) * 100) : 0;

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <DatabaseBackup size={15} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary flex-1">Backfill</h3>
        {backfill.phase && <Badge variant="accent">{PHASE_LABELS[backfill.phase] ?? backfill.phase}</Badge>}
        <Badge
          variant={
            backfill.status === "running"
              ? "info"
              : backfill.status === "done"
                ? "success"
                : backfill.status === "error"
                  ? "danger"
                  : "default"
          }
        >
          {backfill.status}
        </Badge>
        {backfill.status === "running" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await api.post("/brain/backfill/cancel", {});
                addToast("info", "Cancelamento solicitado");
              } catch (e) {
                addToast("error", e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
      {backfill.progress.total > 0 && (
        <div className="h-2 rounded-full bg-bg overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-text-muted">
        <span>
          {backfill.progress.processed}
          {backfill.progress.total > 0 ? ` / ${backfill.progress.total}` : ""} processados
        </span>
        {backfill.progress.currentAccount && <span>conta: {backfill.progress.currentAccount}</span>}
        {backfill.progress.currentMonth && <span>mês: {backfill.progress.currentMonth}</span>}
        {backfill.progress.detail && <span>{backfill.progress.detail}</span>}
        {backfill.startedAt && (
          <span>iniciado {formatDistanceToNow(new Date(backfill.startedAt), { addSuffix: true })}</span>
        )}
      </div>
      {backfill.error && <p className="text-xs text-danger">{backfill.error}</p>}
    </Card>
  );
}
