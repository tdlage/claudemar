import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ModelOption, ProviderInfo } from "../lib/types";

export function useModelSelection(base?: string) {
  const [state, setState] = useState<{ base?: string; models: ModelOption[]; model: string; ready: boolean }>({ base, models: [], model: "", ready: false });
  const [saving, setSaving] = useState(false);
  const targetType = base?.split(":")[0] ?? "";
  const targetName = base?.slice(targetType.length + 1) || (targetType === "orchestrator" ? "orchestrator" : "");
  const supported = ["project", "agent", "orchestrator"].includes(targetType);
  const path = `/executions/model-preference?targetType=${encodeURIComponent(targetType)}&targetName=${encodeURIComponent(targetName)}`;
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const load = () => Promise.all([api.get<ProviderInfo>("/system/provider"), api.get<{ model: string }>(path)]).then(([catalog, selected]) => {
      if (!cancelled) setState({ base, models: catalog.selectableModels, model: selected.model || catalog.defaultModel, ready: true });
    }).catch(() => {});
    void load();
    window.addEventListener("focus", load);
    return () => { cancelled = true; window.removeEventListener("focus", load); };
  }, [base, path, supported]);

  const select = useCallback(async (model: string) => {
    setSaving(true);
    try {
      const saved = await api.put<{ model: string }>(path, { model });
      setState((previous) => previous.base === base ? { ...previous, model: saved.model } : previous);
    } finally { setSaving(false); }
  }, [base, path]);

  const current = state.base === base ? state : { models: [], model: "", ready: false };
  const selected = current.models.find((item) => item.model === current.model);
  return { ...current, selected, select, saving, supported };
}
