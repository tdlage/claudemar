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

const SKIN_TONES = ["#f1c9a5", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
const HAIR_COLORS = ["#2b1d0e", "#4a2f1b", "#6b4423", "#1a1a1a", "#b5651d", "#d9d9d9"];

export interface PixelPalette {
  skin: string;
  hair: string;
  shirt: string;
}

export function pixelPalette(name: string, shirtOverride?: string | null): PixelPalette {
  const h = hash(name);
  return {
    skin: SKIN_TONES[h % SKIN_TONES.length],
    hair: HAIR_COLORS[(h >> 3) % HAIR_COLORS.length],
    shirt: agentColor(name, shirtOverride),
  };
}
