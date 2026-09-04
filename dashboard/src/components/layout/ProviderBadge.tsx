import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { api } from "../../lib/api";
import type { ProviderInfo } from "../../lib/types";

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

  const needsKey = !info.configured;
  const color = needsKey ? "text-red-400" : "text-text-muted";
  const title = `Provedor LLM: ${info.label} · ${info.model}${needsKey ? (info.runtime === "codex" ? " (sem login do ChatGPT)" : " (sem credencial)") : ""}`;

  return (
    <span className={`flex items-center gap-1 text-xs font-mono ${color}`} title={title}>
      <Bot size={12} />
      <span>{info.label} · {info.model}</span>
    </span>
  );
}
