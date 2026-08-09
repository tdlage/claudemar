import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "../shared/Badge";
import { useQuarantine } from "../../hooks/useBrain";
import type { BrainQuarantineItem } from "../../lib/types";

export const QUARANTINE_KIND_META: Record<
  BrainQuarantineItem["kind"],
  { label: string; variant: "danger" | "warning" | "default" }
> = {
  malformed_event: { label: "evento malformado", variant: "warning" },
  ingest_failed: { label: "falha de ingestão", variant: "warning" },
  triage_failed: { label: "falha de triagem", variant: "warning" },
  compile_failed: { label: "falha de compilação", variant: "danger" },
  invalid_operations: { label: "operações inválidas", variant: "danger" },
};

export function QuarantineList() {
  const navigate = useNavigate();
  const { items, loading, error } = useQuarantine();

  if (loading) return <p className="text-sm text-text-muted py-4 text-center">Carregando…</p>;
  if (error) return <p className="text-sm text-danger py-4 text-center">{error}</p>;
  if (items.length === 0) {
    return <p className="text-sm text-success/80 py-4 text-center">Nenhuma operação em quarentena.</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const meta = QUARANTINE_KIND_META[item.kind];
        return (
          <button
            key={item.id}
            onClick={() => navigate(`/second-brain/state/quarantine/${item.id}`)}
            className="w-full text-left bg-surface border border-border rounded-lg px-4 py-2.5 hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Badge variant={meta.variant}>{meta.label}</Badge>
              <span className="text-sm text-text-secondary truncate flex-1">{item.error}</span>
              <span className="text-xs text-text-muted shrink-0">
                {formatDistanceToNow(new Date(item.ts), { addSuffix: true })}
              </span>
            </div>
            {item.threadKey && (
              <p className="text-xs text-text-muted font-mono mt-0.5 truncate">{item.threadKey}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
