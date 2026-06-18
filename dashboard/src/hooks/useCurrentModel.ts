import { useState, useEffect } from "react";
import { api } from "../lib/api";

export interface CurrentModel {
  id: string;
  displayName: string;
}

const FALLBACK: CurrentModel = { id: "opus", displayName: "Opus 4.8" };

let globalCache: CurrentModel | null = null;

export function useCurrentModel(): CurrentModel {
  const [model, setModel] = useState<CurrentModel>(globalCache ?? FALLBACK);

  useEffect(() => {
    if (globalCache) return;
    api.get<CurrentModel>("/system/model").then((data) => {
      if (data?.id && data?.displayName) {
        globalCache = data;
        setModel(data);
      }
    }).catch(() => {});
  }, []);

  return model;
}
