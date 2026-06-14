export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

export function formatUsage(costUsd: number, totalTokens: number): string {
  if (costUsd > 0) return `$${costUsd.toFixed(2)}`;
  if (totalTokens > 0) {
    return totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k tok`
      : `${totalTokens} tok`;
  }
  return "$0.00";
}
