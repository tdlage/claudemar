import { useState, useEffect } from "react";
import { api } from "../lib/api";
import type { AgentRuntime } from "../lib/types";

export interface CurrentModel {
  id: string;
  displayName: string;
  runtime: AgentRuntime;
}

const FALLBACK: CurrentModel = { id: "claude-opus-5", displayName: "Opus 5", runtime: "claude" };

let globalCache: CurrentModel | null = null;

export function useCurrentModel(): CurrentModel {
  const [model, setModel] = useState<CurrentModel>(globalCache ?? FALLBACK);

  useEffect(() => {
    api.get<CurrentModel>("/system/model").then((data) => {
      if (data?.id && data?.displayName && (data.runtime === "claude" || data.runtime === "codex")) {
        globalCache = data;
        setModel(data);
      }
    }).catch(() => {});
  }, []);

  return model;
}
