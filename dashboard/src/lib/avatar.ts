const PALETTE = [
  "#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#06b6d4",
  "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#3b82f6",
];

function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function agentColor(name: string, override?: string | null): string {
  if (override) return override;
  return PALETTE[hash(name) % PALETTE.length];
}

export function agentInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
