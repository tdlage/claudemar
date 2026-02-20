import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../../lib/api";

interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

interface TokenUsageData {
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  error?: string;
}

function barColor(pct: number): string {
  if (pct >= 80) return "bg-danger";
  if (pct >= 50) return "bg-warning";
  return "bg-success";
}

function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "now";
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}d${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

interface TokenUsageProps {
  collapsed: boolean;
}

export function TokenUsage({ collapsed }: TokenUsageProps) {
  const [data, setData] = useState<TokenUsageData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((force = false) => {
    const url = force ? "/system/token-usage?force=1" : "/system/token-usage";
    setLoading(true);
    api.get<TokenUsageData>(url).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 300_000);
    return () => clearInterval(interval);
  }, [load]);

  if (!data || data.error) return null;

  const bars = [
    { label: "5h", pct: Math.round(data.fiveHour.utilization), reset: data.fiveHour.resetsAt },
    { label: "7d", pct: Math.round(data.sevenDay.utilization), reset: data.sevenDay.resetsAt },
  ];

  if (collapsed) {
    return (
      <div className="px-2 py-2 space-y-1.5">
        {bars.map((b) => (
          <div key={b.label} title={`${b.label}: ${b.pct}% — resets ${formatReset(b.reset)}`}>
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(b.pct)}`}
                style={{ width: `${Math.min(b.pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
        <button
          onClick={() => load(true)}
          className="flex justify-center w-full text-text-muted hover:text-text-primary transition-colors"
          title="Refresh usage"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Usage</span>
        <button
          onClick={() => load(true)}
          className="text-text-muted hover:text-text-primary transition-colors"
          title="Refresh usage"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {bars.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-medium text-text-muted">{b.label}</span>
            <span className="text-[10px] text-text-muted">
              {b.pct}%
              {b.reset && <span className="ml-1 opacity-60">· {formatReset(b.reset)}</span>}
            </span>
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor(b.pct)}`}
              style={{ width: `${Math.min(b.pct, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
