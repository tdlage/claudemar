import { useState, useEffect } from "react";
import { api } from "../lib/api";

interface DiscoveredModel {
  id: string;
  displayName: string;
  createdAt: string;
  provider?: "claude" | "codex";
}

const FALLBACK_MODELS: DiscoveredModel[] = [
  { id: "codex", displayName: "Codex default", createdAt: "", provider: "codex" },
  { id: "chat-latest", displayName: "Chat Latest (Instant)", createdAt: "", provider: "codex" },
  { id: "gpt-5.5", displayName: "GPT-5.5", createdAt: "", provider: "codex" },
  { id: "gpt-5.5-pro", displayName: "GPT-5.5 Pro", createdAt: "", provider: "codex" },
  { id: "gpt-5.4", displayName: "GPT-5.4", createdAt: "", provider: "codex" },
  { id: "gpt-5.4-pro", displayName: "GPT-5.4 Pro", createdAt: "", provider: "codex" },
  { id: "gpt-5.4-mini", displayName: "GPT-5.4 mini", createdAt: "", provider: "codex" },
  { id: "gpt-5.4-nano", displayName: "GPT-5.4 nano", createdAt: "", provider: "codex" },
  { id: "claude-opus-4-7", displayName: "Opus 4.7", createdAt: "", provider: "claude" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", createdAt: "", provider: "claude" },
  { id: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", createdAt: "", provider: "claude" },
];

let globalCache: DiscoveredModel[] | null = null;

export function useModels() {
  const [models, setModels] = useState<DiscoveredModel[]>(globalCache ?? FALLBACK_MODELS);

  useEffect(() => {
    if (globalCache) return;
    api.get<DiscoveredModel[]>("/system/models").then((data) => {
      if (data.length > 0) {
        globalCache = data;
        setModels(data);
      }
    }).catch(() => {});
  }, []);

  return models;
}
