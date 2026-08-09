import { Card } from "../shared/Card";
import type { BrainDayMetrics } from "../../lib/types";

const LEVELS = [
  { key: "relevance:0", label: "0 ruído", className: "bg-border" },
  { key: "relevance:1", label: "1 transacional", className: "bg-blue-500/60" },
  { key: "relevance:2", label: "2 relevante", className: "bg-accent" },
  { key: "relevance:3", label: "3 crítico", className: "bg-warning" },
];

export function TriageBar({ metrics }: { metrics: BrainDayMetrics[] }) {
  const totals = LEVELS.map((level) =>
    metrics.reduce((acc, day) => acc + (day.fields[level.key] ?? 0), 0),
  );
  const total = totals.reduce((a, b) => a + b, 0);

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">Triagem (últimos 7 dias)</h3>
      {total === 0 ? (
        <p className="text-xs text-text-muted">Nenhuma thread triada ainda. Ligue a triagem em Configurações quando a ingestão estiver validada.</p>
      ) : (
        <>
          <div className="flex h-3 rounded-full overflow-hidden bg-bg">
            {LEVELS.map((level, i) =>
              totals[i] > 0 ? (
                <div
                  key={level.key}
                  className={level.className}
                  style={{ width: `${(totals[i] / total) * 100}%` }}
                  title={`${level.label}: ${totals[i]}`}
                />
              ) : null,
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {LEVELS.map((level, i) => (
              <span key={level.key} className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span className={`w-2 h-2 rounded-sm ${level.className}`} />
                {level.label} · {totals[i]}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
