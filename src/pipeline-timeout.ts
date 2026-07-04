// Resolve o timeout efetivo de uma execução do pipeline (stage ou intake).
// null/undefined = não configurado → usa o default global; 0 = desligado (sem timeout);
// >0 = valor explícito em ms. Nunca colapsa 0 em default (não usar `||`).
export function resolveTimeoutMs(configured: number | null | undefined, globalDefaultMs: number): number {
  return configured ?? globalDefaultMs;
}
