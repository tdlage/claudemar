import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { pipelineManager } from "./pipeline-manager.js";
import type { PipelineStage } from "./pipeline-migration.js";
import { config } from "./config.js";
import { cardRepoWorktreePath } from "./pipeline-worktree.js";
import { getPullRequestBody, updatePullRequestBody } from "./github-actions.js";
import { buildEvidenceImageUrls, buildE2eEvidenceSection, upsertEvidenceSection } from "./pipeline-pr-evidence.js";

export interface PipelineMcpContext {
  runId: string;
  cardId: string | null;
  pipelineId: string;
  stage: PipelineStage;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(err: unknown) {
  return {
    content: [{ type: "text" as const, text: `Falha: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

async function embedE2eEvidenceInPr(cardId: string, repoName: string, prNumber: number): Promise<void> {
  const screenshots = await pipelineManager.getCardE2eScreenshots(cardId);
  const images = buildEvidenceImageUrls(screenshots, config.publicBaseUrl);
  const section = buildE2eEvidenceSection(images);
  if (!section) return;
  const repoPath = cardRepoWorktreePath(cardId, repoName);
  const currentBody = await getPullRequestBody(repoPath, prNumber);
  const newBody = upsertEvidenceSection(currentBody, section);
  if (newBody === currentBody) return;
  await updatePullRequestBody(repoPath, prNumber, newBody);
}

export function createPipelineMcpServer(ctx: PipelineMcpContext): ReturnType<typeof createSdkMcpServer> {
  const requireCard = (): string => {
    if (!ctx.cardId) throw new Error("Esta etapa não está vinculada a um card.");
    return ctx.cardId;
  };

  const reportRequirement = tool(
    "report_requirement",
    "Registra o requisito elaborado para o card. Chame ao final da etapa de requisito.",
    { requirement: z.string().min(1).describe("O requisito completo em markdown (objetivo, contexto, critérios de aceitação, escopo, fora-de-escopo).") },
    async (args) => {
      try {
        const cardId = requireCard();
        await pipelineManager.updateCard(cardId, { requirementText: args.requirement });
        await pipelineManager.mergeRunArtifacts(ctx.runId, { requirement: args.requirement });
        return ok("Requisito registrado.");
      } catch (err) { return fail(err); }
    },
  );

  const reportPlan = tool(
    "report_plan",
    "Registra o plano de implementação e os repositórios-alvo. Chame ao final da etapa de plano.",
    {
      plan_markdown: z.string().min(1).describe("O plano de implementação e arquitetura em markdown."),
      repos: z.array(z.string()).describe("Nomes dos repositórios do projeto que serão alterados por este card (use '.' para o repo raiz)."),
    },
    async (args) => {
      try {
        const cardId = requireCard();
        await pipelineManager.updateCard(cardId, { planMarkdown: args.plan_markdown });
        const pipeline = await pipelineManager.getPipeline(ctx.pipelineId);
        const baseBranch = pipeline?.defaultBaseBranch || "main";
        for (const repo of args.repos) {
          await pipelineManager.upsertCardRepo(cardId, repo, baseBranch);
        }
        await pipelineManager.mergeRunArtifacts(ctx.runId, { plan: { markdown: args.plan_markdown, repos: args.repos } });
        return ok(`Plano registrado. Repositórios-alvo: ${args.repos.join(", ") || "(nenhum novo)"}.`);
      } catch (err) { return fail(err); }
    },
  );

  const reportTestResult = tool(
    "report_test_result",
    "Registra o resultado dos testes automatizados da implementação. Chame ao final da etapa de implementação.",
    {
      passed: z.boolean().describe("true se TODOS os testes automatizados passaram."),
      total: z.number().describe("Número total de testes executados."),
      failed: z.number().describe("Número de testes que falharam."),
      logs: z.string().describe("Logs/resumo da execução dos testes (especialmente das falhas)."),
    },
    async (args) => {
      try {
        await pipelineManager.mergeRunArtifacts(ctx.runId, { tests: { passed: args.passed, total: args.total, failed: args.failed, logs: args.logs } });
        return ok(`Resultado de testes registrado (passed=${args.passed}).`);
      } catch (err) { return fail(err); }
    },
  );

  const reportCodeReview = tool(
    "report_code_review",
    "Registra o resultado do code-review (/code-review --fix) da etapa code_review. Chame ao final, após corrigir todos os pontos e re-rodar os testes.",
    {
      total_findings: z.number().describe("Total de pontos identificados pelo code-review."),
      fixed: z.number().describe("Quantos pontos foram corrigidos."),
      clean: z.boolean().describe("true se, após as correções, o code-review não aponta mais nenhum problema."),
      tests_pass: z.boolean().describe("true se os testes automatizados continuam passando após as correções."),
      summary: z.string().describe("Resumo do que foi revisado e corrigido."),
    },
    async (args) => {
      try {
        await pipelineManager.mergeRunArtifacts(ctx.runId, {
          review: { totalFindings: args.total_findings, fixed: args.fixed, clean: args.clean, testsPass: args.tests_pass, summary: args.summary },
        });
        return ok(`Code review registrado (clean=${args.clean}, tests_pass=${args.tests_pass}).`);
      } catch (err) { return fail(err); }
    },
  );

  const reportE2e = tool(
    "report_e2e",
    "Registra o resultado do teste end-to-end com as evidências. Chame ao final da etapa de E2E.",
    {
      passed: z.boolean().describe("true se o teste end-to-end passou."),
      screenshots: z.array(z.string()).describe("Nomes dos arquivos de screenshot salvos no diretório de artefatos informado no contexto."),
      logs: z.string().describe("Logs/resumo do teste E2E."),
    },
    async (args) => {
      try {
        await pipelineManager.mergeRunArtifacts(ctx.runId, { e2e: { passed: args.passed, screenshots: args.screenshots, logs: args.logs } });
        return ok(`E2E registrado (passed=${args.passed}).`);
      } catch (err) { return fail(err); }
    },
  );

  const reportPullRequest = tool(
    "report_pull_request",
    "Registra um Pull Request aberto para um repositório do card. Chame UMA VEZ POR REPOSITÓRIO na etapa de pull_request.",
    {
      repo: z.string().describe("Nome do repositório (como em report_plan; '.' para o repo raiz)."),
      url: z.string().describe("URL do Pull Request."),
      number: z.number().describe("Número do Pull Request."),
    },
    async (args) => {
      try {
        const cardId = requireCard();
        const matched = await pipelineManager.setCardRepoPr(cardId, args.repo, args.url, args.number);
        if (!matched) return fail(new Error(`'${args.repo}' não é um repositório-alvo deste card. Use exatamente um dos nomes listados em "Worktrees".`));
        const run = await pipelineManager.getRun(ctx.runId);
        const prs = [...(run?.artifacts.prs ?? []).filter((p) => p.repo !== args.repo), { repo: args.repo, url: args.url, number: args.number }];
        await pipelineManager.mergeRunArtifacts(ctx.runId, { prs });
        try {
          await embedE2eEvidenceInPr(cardId, args.repo, args.number);
        } catch (err) {
          console.error(`[pipeline-mcp] failed to embed E2E evidence in PR ${args.repo}#${args.number}:`, err);
        }
        return ok(`PR registrado para ${args.repo}: ${args.url}`);
      } catch (err) { return fail(err); }
    },
  );

  const proposeItems = tool(
    "propose_items",
    "Propõe novos itens de trabalho (cards) a partir da fonte de captação. Use apenas na etapa de intake.",
    {
      items: z.array(z.object({
        title: z.string().describe("Título curto do item proposto."),
        input: z.string().describe("Descrição/contexto que servirá de entrada para a etapa de requisito."),
        repos: z.array(z.string()).optional().describe("Repositórios-alvo sugeridos (opcional)."),
        origin_ref: z.string().optional().describe("Referência da origem (ex.: URL/identificador da fonte)."),
      })).describe("Lista de itens propostos."),
    },
    async (args) => {
      try {
        let created = 0;
        for (const item of args.items) {
          await pipelineManager.createCard({
            pipelineId: ctx.pipelineId,
            title: item.title,
            intakeInput: item.input,
            originType: "agent",
            originRef: item.origin_ref,
            repos: item.repos,
            createdBy: "pipeline-intake",
          });
          created++;
        }
        await pipelineManager.mergeRunArtifacts(ctx.runId, { items: args.items.map((i) => ({ title: i.title, input: i.input })) });
        return ok(`${created} item(ns) criado(s).`);
      } catch (err) { return fail(err); }
    },
  );

  return createSdkMcpServer({
    name: "pipeline",
    version: "1.0.0",
    tools: [reportRequirement, reportPlan, reportTestResult, reportCodeReview, reportE2e, reportPullRequest, proposeItems],
  });
}
