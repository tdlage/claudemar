import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../../lib/api";

interface UsageWindow {
  label: string;
  utilization: number;
  resetsAt: string | null;
}

interface TokenUsageData {
  provider: UsageProvider;
  windows: UsageWindow[];
  error?: string;
}

type UsageProvider = "anthropic" | "openai";

const PROVIDERS: { id: UsageProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
];

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

export function TokenUsage() {
  const [dataByProvider, setDataByProvider] = useState<Partial<Record<UsageProvider, TokenUsageData>>>({});
  const [errorByProvider, setErrorByProvider] = useState<Partial<Record<UsageProvider, string>>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback((provider: UsageProvider, force = false) => {
    const params = new URLSearchParams({ provider });
    if (force) params.set("force", "1");
    return api.get<TokenUsageData>(`/system/token-usage?${params}`).then((response) => {
      if (response.error) {
        setErrorByProvider((current) => ({ ...current, [provider]: response.error }));
        return;
      }
      setDataByProvider((current) => ({ ...current, [provider]: response }));
      setErrorByProvider((current) => ({ ...current, [provider]: undefined }));
    }).catch((error) => {
      setErrorByProvider((current) => ({
        ...current,
        [provider]: error instanceof Error ? error.message : "Usage unavailable",
      }));
    });
  }, []);

  const loadAll = useCallback(
    (force = false) => Promise.all(PROVIDERS.map(({ id }) => load(id, force))),
    [load],
  );

  useEffect(() => {
    void loadAll();
    const interval = setInterval(() => void loadAll(), 300_000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const refresh = () => {
    setLoading(true);
    void loadAll(true).finally(() => setLoading(false));
  };

  return (
    <div className="px-3 py-2 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Usage</span>
        <button
          onClick={refresh}
          className="text-text-muted hover:text-text-primary transition-colors"
          title="Refresh usage"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {PROVIDERS.map(({ id, label }) => (
        <ProviderUsage
          key={id}
          label={label}
          data={dataByProvider[id]}
          error={errorByProvider[id]}
        />
      ))}
    </div>
  );
}

interface ProviderUsageProps {
  label: string;
  data?: TokenUsageData;
  error?: string;
}

function ProviderUsage({ label, data, error }: ProviderUsageProps) {
  const bars = (data?.windows ?? []).map((window) => ({
    label: window.label,
    pct: Math.round(window.utilization),
    reset: window.resetsAt,
  }));

  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider">{label}</span>
      {error && <p className="text-[10px] leading-tight text-danger break-words">{error}</p>}
      {!error && bars.length === 0 && <p className="text-[10px] text-text-muted">Loading…</p>}
      {bars.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[11px] font-semibold text-text-secondary">{b.label}</span>
            <span className="text-[11px] font-medium text-text-secondary">
              {b.pct}%
              {b.reset && <span className="ml-1 opacity-70">· {formatReset(b.reset)}</span>}
            </span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
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
