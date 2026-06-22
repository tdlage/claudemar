import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { api } from "../../lib/api";

interface ProviderInfo {
  provider: "anthropic" | "zai";
  label: string;
  model: string;
  configured: boolean;
}

export function ProviderBadge() {
  const [info, setInfo] = useState<ProviderInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      api.get<ProviderInfo>("/system/provider").then((data) => {
        if (mounted) setInfo(data);
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!info) return null;

  const needsKey = info.provider === "zai" && !info.configured;
  const color = needsKey ? "text-red-400" : "text-text-muted";
  const title = `Provedor LLM: ${info.label} · ${info.model}${needsKey ? " (sem API key)" : ""}`;

  return (
    <span className={`flex items-center gap-1 text-xs font-mono ${color}`} title={title}>
      <Bot size={12} />
      <span>{info.label} · {info.model}</span>
    </span>
  );
}
