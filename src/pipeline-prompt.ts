export function buildPlanReposInstruction(targetRepoNames: string[]): string {
  const guidance = targetRepoNames.length > 0
    ? `Os repositórios-alvo atuais do card são: ${targetRepoNames.join(", ")}. Priorize-os; se o plano precisar afetar um repositório fora dessa lista, justifique explicitamente no markdown do plano.`
    : `O card ainda não tem repositórios-alvo definidos — identifique você os repositórios afetados.`;
  return `## Repositórios afetados\nAo chamar report_plan, informe em \`repos\` SOMENTE os repositórios que serão de fato alterados por este plano (não liste repositórios apenas inspecionados). ${guidance}`;
}
