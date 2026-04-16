import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface DiscoveredModel {
  id: string;
  displayName: string;
  createdAt: string;
}

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
  if (!token) return cache?.models ?? [];

  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        "x-api-key": token,
        "anthropic-version": "2023-06-01",
        "Authorization": `Bearer ${token}`,
      },
    });

    if (!response.ok) return cache?.models ?? [];

    const json = await response.json() as { data?: { id: string; display_name?: string; created_at?: string }[] };
    if (!json.data?.length) return cache?.models ?? [];

    const models = json.data
      .filter((m) => /^claude-/.test(m.id) && !/^claude-3/.test(m.id))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .map((m) => ({
        id: m.id,
        displayName: m.display_name || formatDisplayName(m.id),
        createdAt: m.created_at ?? "",
      }));

    cache = { models, fetchedAt: Date.now() };
    return models;
  } catch {
    return cache?.models ?? [];
  }
}

export function invalidateModelsCache(): void {
  cache = null;
}
