export const DEFAULT_OPUS_DISPLAY = "Opus 4.8";

interface DiscoveredModel {
  id: string;
  displayName: string;
  createdAt: string;
  provider: "claude";
}

const CLAUDE_DEFAULT_MODELS: DiscoveredModel[] = [
  { id: "claude-opus-4-8", displayName: "Opus 4.8", createdAt: "", provider: "claude" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", createdAt: "", provider: "claude" },
  { id: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", createdAt: "", provider: "claude" },
];

function formatDisplayName(id: string): string {
  const match = id.match(/^claude-(\w+)-(\d+)-(\d+)/);
  if (!match) return id;
  const [, tier, major, minor] = match;
  const tierCapitalized = tier.charAt(0).toUpperCase() + tier.slice(1);
  return `${tierCapitalized} ${major}.${minor}`;
}

export function getModelDisplayName(id: string): string {
  if (!id || id === "opus") return DEFAULT_OPUS_DISPLAY;
  const known = CLAUDE_DEFAULT_MODELS.find((m) => m.id === id);
  if (known) return known.displayName;
  return formatDisplayName(id);
}
