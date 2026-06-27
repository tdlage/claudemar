export interface CardUsage {
  totalCostUsd: number;
  totalTokens: number;
  contextPct: number;
}

export const EMPTY_CARD_USAGE: CardUsage = { totalCostUsd: 0, totalTokens: 0, contextPct: 0 };

export interface UsageRunInput {
  status: string;
  costUsd: number;
  totalTokens: number;
  contextPct: number;
  startedAt: number;
}

// Custo e tokens são somáveis entre as runs do card. contextPct é por-sessão (cada etapa é uma
// sessão nova): mostra-se o da run ativa (mais recente em execução) ou, sem run ativa, o da última
// run iniciada — nunca a soma.
export function aggregateCardUsage(runs: UsageRunInput[]): CardUsage {
  let totalCostUsd = 0;
  let totalTokens = 0;
  for (const run of runs) {
    totalCostUsd += run.costUsd;
    totalTokens += run.totalTokens;
  }

  const running = runs.filter((r) => r.status === "running");
  const pool = running.length > 0 ? running : runs;
  let contextPct = 0;
  let latest = -Infinity;
  for (const run of pool) {
    if (run.startedAt >= latest) {
      latest = run.startedAt;
      contextPct = run.contextPct;
    }
  }

  return { totalCostUsd, totalTokens, contextPct };
}
