import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ModelOption, ProviderInfo } from "../lib/types";
import { executionTargetFromBase } from "../lib/target";

export function useModelSelection(base?: string, executionId?: string | null) {
  const [state, setState] = useState<{ base?: string; models: ModelOption[]; model: string; ready: boolean }>({ base, models: [], model: "", ready: false });
  const manualSelection = useRef<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const target = executionTargetFromBase(base);
  const supported = target !== null;
  const path = `/executions/model-preference?targetType=${encodeURIComponent(target?.targetType ?? "")}&targetName=${encodeURIComponent(target?.targetName ?? "")}`;
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    manualSelection.current = undefined;
    const load = () => Promise.all([api.get<ProviderInfo>("/system/provider"), api.get<{ model: string }>(path)]).then(([catalog, selected]) => {
      if (!cancelled) setState((previous) => ({ base, models: catalog.selectableModels, model: manualSelection.current === base && previous.base === base ? previous.model : selected.model || catalog.defaultModel, ready: true }));
    }).catch(() => {});
    void load();
    window.addEventListener("focus", load);
    return () => { cancelled = true; window.removeEventListener("focus", load); };
  }, [base, path, supported, executionId]);

  const select = useCallback(async (model: string) => {
    manualSelection.current = base;
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
