export function buildPlanReposInstruction(selectedRepoNames: string[]): string {
  const restriction = selectedRepoNames.length > 0
    ? `O usuário pré-selecionou estes repositórios-alvo: ${selectedRepoNames.join(", ")}. Restrinja os repositórios reportados a esse conjunto; se algum repo fora dele for realmente necessário, justifique explicitamente no markdown do plano.`
    : `O usuário não pré-selecionou repositórios — identifique você os repositórios afetados.`;
  return `## Repositórios afetados\nAo chamar report_plan, informe em \`repos\` SOMENTE os repositórios que serão de fato alterados por este plano (não liste repositórios apenas inspecionados). ${restriction}`;
}
