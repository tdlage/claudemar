import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface DiscoveredModel {
  id: string;
  displayName: string;
  createdAt: string;
  provider: "claude" | "codex";
}

const CODEX_MODELS: DiscoveredModel[] = [
  { id: "codex", displayName: "Codex default", createdAt: "", provider: "codex" },
  { id: "chat-latest", displayName: "Chat Latest (Instant)", createdAt: "", provider: "codex" },
  { id: "gpt-5.5", displayName: "GPT-5.5", createdAt: "", provider: "codex" },
  { id: "gpt-5.5-pro", displayName: "GPT-5.5 Pro", createdAt: "", provider: "codex" },
  { id: "gpt-5.4", displayName: "GPT-5.4", createdAt: "", provider: "codex" },
  { id: "gpt-5.4-pro", displayName: "GPT-5.4 Pro", createdAt: "", provider: "codex" },
  { id: "gpt-5.4-mini", displayName: "GPT-5.4 mini", createdAt: "", provider: "codex" },
  { id: "gpt-5.4-nano", displayName: "GPT-5.4 nano", createdAt: "", provider: "codex" },
];

const CLAUDE_DEFAULT_MODELS: DiscoveredModel[] = [
  { id: "claude-opus-4-7", displayName: "Opus 4.7", createdAt: "", provider: "claude" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", createdAt: "", provider: "claude" },
  { id: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", createdAt: "", provider: "claude" },
];

const DEFAULT_MODELS: DiscoveredModel[] = [...CODEX_MODELS, ...CLAUDE_DEFAULT_MODELS];

let cache: { models: DiscoveredModel[]; fetchedAt: number } | null = null;
const CACHE_TTL = 3600_000;

function getClaudeAccessToken(): string | null {
  const credPath = resolve(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(credPath, "utf-8"));
    return raw?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

function formatDisplayName(id: string): string {
  const match = id.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (!match) return id;
  const [, tier, major, minor] = match;
  const tierCapitalized = tier.charAt(0).toUpperCase() + tier.slice(1);
  return `${tierCapitalized} ${major}.${minor}`;
}

export async function discoverModels(): Promise<DiscoveredModel[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.models;
  }

  const token = getClaudeAccessToken();
  if (!token) return cache?.models ?? [...DEFAULT_MODELS];

  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "Authorization": `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.warn(`[models-discovery] Anthropic API returned ${response.status}; using default Claude models`);
      return cache?.models ?? [...DEFAULT_MODELS];
    }

    const json = await response.json() as { data?: { id: string; display_name?: string; created_at?: string }[] };
    if (!json.data?.length) return cache?.models ?? [...DEFAULT_MODELS];

    const claudeModels = json.data
      .filter((m) => /^claude-/.test(m.id) && !/^claude-3/.test(m.id))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .map((m) => ({
        id: m.id,
        displayName: m.display_name || formatDisplayName(m.id),
        createdAt: m.created_at ?? "",
        provider: "claude" as const,
      }));

    const merged = claudeModels.length > 0 ? claudeModels : CLAUDE_DEFAULT_MODELS;
    const models = [...CODEX_MODELS, ...merged];
    cache = { models, fetchedAt: Date.now() };
    return models;
  } catch (err) {
    console.warn(`[models-discovery] Anthropic API fetch failed: ${err instanceof Error ? err.message : String(err)}; using default Claude models`);
    return cache?.models ?? [...DEFAULT_MODELS];
  }
}

export function invalidateModelsCache(): void {
  cache = null;
}
