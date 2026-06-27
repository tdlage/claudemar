import { formatUsage } from "../../lib/types";

interface Props {
  costUsd: number;
  totalTokens: number;
  contextPct: number;
  className?: string;
}

export function UsageIndicator({ costUsd, totalTokens, contextPct, className = "" }: Props) {
  const high = contextPct >= 80;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span title="Custo acumulado de tokens">{formatUsage(costUsd, totalTokens)}</span>
      <span className={high ? "text-warning" : ""} title="Contexto da sessão utilizado">
        ctx {contextPct > 0 ? `${Math.round(contextPct)}%` : "—"}
      </span>
    </span>
  );
}
