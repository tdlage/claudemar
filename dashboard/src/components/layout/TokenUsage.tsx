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
  const [provider, setProvider] = useState<UsageProvider>(() => {
    return localStorage.getItem("usage-provider") === "openai" ? "openai" : "anthropic";
  });
  const [dataByProvider, setDataByProvider] = useState<Partial<Record<UsageProvider, TokenUsageData>>>({});
  const [errorByProvider, setErrorByProvider] = useState<Partial<Record<UsageProvider, string>>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback((selectedProvider: UsageProvider, force = false) => {
    const params = new URLSearchParams({ provider: selectedProvider });
    if (force) params.set("force", "1");
    return api.get<TokenUsageData>(`/system/token-usage?${params}`).then((response) => {
      if (response.error) {
        setErrorByProvider((current) => ({ ...current, [selectedProvider]: response.error }));
        return;
      }
      setDataByProvider((current) => ({ ...current, [selectedProvider]: response }));
      setErrorByProvider((current) => ({ ...current, [selectedProvider]: undefined }));
    }).catch((error) => {
      setErrorByProvider((current) => ({
        ...current,
        [selectedProvider]: error instanceof Error ? error.message : "Usage unavailable",
      }));
    });
  }, []);

  useEffect(() => {
    void load(provider);
    const interval = setInterval(() => void load(provider), 300_000);
    return () => clearInterval(interval);
  }, [load, provider]);

  const selectProvider = (value: UsageProvider) => {
    localStorage.setItem("usage-provider", value);
    setProvider(value);
  };

  const refresh = () => {
    setLoading(true);
    void load(provider, true).finally(() => setLoading(false));
  };

  const data = dataByProvider[provider];
  const error = errorByProvider[provider];
  const bars = (data?.windows ?? []).map((window) => ({
    label: window.label,
    pct: Math.round(window.utilization),
    reset: window.resetsAt,
  }));

  if (collapsed) {
    return (
      <div className="px-2 py-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-0.5">
          {(["anthropic", "openai"] as const).map((item) => (
            <button
              key={item}
              onClick={() => selectProvider(item)}
              className={`rounded py-0.5 text-[9px] font-semibold transition-colors ${provider === item ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"}`}
              title={item === "anthropic" ? "Anthropic usage" : "OpenAI usage"}
            >
              {item === "anthropic" ? "A" : "O"}
            </button>
          ))}
        </div>
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
          onClick={refresh}
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
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Usage</span>
        <div className="flex items-center gap-1.5">
          <select
            value={provider}
            onChange={(event) => selectProvider(event.target.value as UsageProvider)}
            className="bg-bg border border-border rounded px-1 py-0.5 text-[10px] text-text-secondary focus:outline-none focus:border-accent"
            aria-label="Usage provider"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <button
            onClick={refresh}
            className="text-text-muted hover:text-text-primary transition-colors"
            title="Refresh usage"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
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
