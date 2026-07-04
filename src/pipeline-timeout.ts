// Resolve o timeout efetivo de uma execução do pipeline (stage ou intake).
// 0 = desligado (sem timeout); >0 = valor explícito em ms. Qualquer outra coisa
// (null/undefined não configurado, NaN, negativo, tipo inválido vindo de JSON) cai no
// default global — preservando a proteção. Nunca colapsa 0 em default (não usar `||`).
export function resolveTimeoutMs(configured: number | null | undefined, globalDefaultMs: number): number {
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) return configured;
  return globalDefaultMs;
}
