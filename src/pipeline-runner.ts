import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { executionManager, type ExecutionInfo } from "./execution-manager.js";
import { pipelineManager, type PipelineCard, type RunStatus, type StageArtifacts } from "./pipeline-manager.js";
import { cardWorktreeRoot, PIPELINE_WORKTREES_ROOT } from "./pipeline-worktree.js";
import { signUploadUrl } from "./upload-signer.js";
import { config } from "./config.js";
import { settingsManager } from "./settings-manager.js";
import { query, execute } from "./database.js";
import { createPipelineMcpServer } from "./pipeline-mcp.js";
import { buildPlanReposInstruction } from "./pipeline-prompt.js";
import { resolveTimeoutMs } from "./pipeline-timeout.js";
import { pipelineEventManager, type PrFeedbackEvent, type PrMergedEvent, type PrReopenedEvent } from "./pipeline-events.js";
import type { PipelineStage } from "./pipeline-migration.js";

const UPLOADS_DIR = resolve(config.dataPath, "tracker-uploads");
const EVIDENCE_SUBDIR = ".pipeline-evidence";
const MAX_RUN_OUTPUT = 200_000;
const USAGE_EMIT_INTERVAL_MS = 1000;

interface RunMapping {
  runId: string;
  cardId: string;
  stage: PipelineStage;
}

interface LiveUsage {
  costUsd: number;
  totalTokens: number;
  contextPct: number;
}

interface LiveUsageEntry {
  value: LiveUsage;
  lastEmit: number;
}

const REPORT_TOOL: Partial<Record<PipelineStage, string>> = {
  intake: "mcp__pipeline__propose_items",
  requirement: "mcp__pipeline__report_requirement",
  plan: "mcp__pipeline__report_plan",
  implementation: "mcp__pipeline__report_test_result",
  code_review: "mcp__pipeline__report_code_review",
  e2e: "mcp__pipeline__report_e2e",
  pull_request: "mcp__pipeline__report_pull_request",
};

class PipelineRunner {
  private queue: { cardId: string; stage: PipelineStage }[] = [];
  private active = 0;
  private inFlight = new Set<string>();
  private pending = new Map<string, PipelineStage>();
  private execMap = new Map<string, RunMapping>();
  private liveUsage = new Map<string, LiveUsageEntry>();
  private started = false;

  init(): void {
    if (this.started) return;
    this.started = true;

    pipelineManager.on("stage:request", ({ cardId, stage }: { cardId: string; stage: PipelineStage }) => {
      this.enqueue(cardId, stage);
    });

    executionManager.on("complete", (execId: string, info: ExecutionInfo) => {
      const mapping = this.execMap.get(execId);
      if (!mapping) return;
      this.execMap.delete(execId);
      this.handleStageDone(mapping, info, false).catch((err) => console.error("[pipeline-runner] complete handler failed:", err));
    });

    executionManager.on("error", (execId: string, info: ExecutionInfo) => {
      const mapping = this.execMap.get(execId);
      if (!mapping) return;
      this.execMap.delete(execId);
      this.handleStageDone(mapping, info, true).catch((err) => console.error("[pipeline-runner] error handler failed:", err));
    });

    executionManager.on("usage", (execId: string, costUsd: number, tokens: number, contextPct: number) => {
      const mapping = this.execMap.get(execId);
      if (!mapping) return;
      const value: LiveUsage = { costUsd, totalTokens: tokens, contextPct };
      const lastEmit = this.liveUsage.get(execId)?.lastEmit ?? 0;
      const now = Date.now();
      if (now - lastEmit < USAGE_EMIT_INTERVAL_MS) {
        this.liveUsage.set(execId, { value, lastEmit });
        return;
      }
      this.liveUsage.set(execId, { value, lastEmit: now });
      pipelineManager.emitRunUsage(mapping.cardId, mapping.runId, value).catch((err) => console.error("[pipeline-runner] emitRunUsage failed:", err));
    });

    pipelineEventManager.on("pr:feedback", (e: PrFeedbackEvent) => {
      pipelineManager.handlePrFeedback(e.repoFullName, e.prNumber, e.body, e.author).catch((err) => console.error("[pipeline-runner] pr:feedback failed:", err));
    });

    pipelineEventManager.on("pr:closed", (e: PrMergedEvent) => {
      pipelineManager.handlePrClosed(e.repoFullName, e.prNumber, e.merged).catch((err) => console.error("[pipeline-runner] pr:closed failed:", err));
    });

    pipelineEventManager.on("pr:reopened", (e: PrReopenedEvent) => {
      pipelineManager.handlePrReopened(e.repoFullName, e.prNumber).catch((err) => console.error("[pipeline-runner] pr:reopened failed:", err));
    });
  }

  // Um card só roda UMA etapa por vez (sessão SDK + worktree são compartilhadas). Enquanto o
  // card está em execução, o próximo pedido (inclusive a próxima etapa emitida em onStageResult)
  // fica pendente e é drenado quando o slot é liberado — nunca é descartado nem inicia em paralelo.
  enqueue(cardId: string, stage: PipelineStage): void {
    if (this.inFlight.has(cardId)) { this.pending.set(cardId, stage); return; }
    if (this.queue.some((q) => q.cardId === cardId)) return;
    this.queue.push({ cardId, stage });
    this.pump();
  }

  private pump(): void {
    while (this.active < config.maxParallelPipelineRuns && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.inFlight.add(item.cardId);
      this.startStage(item.cardId, item.stage).catch((err) => {
        console.error(`[pipeline-runner] startStage failed for ${item.cardId}/${item.stage}:`, err);
        pipelineManager.failCard(item.cardId).catch(() => {});
        this.releaseSlot(item.cardId);
      });
    }
  }

  private releaseSlot(cardId: string): void {
    this.inFlight.delete(cardId);
    this.active--;
    const next = this.pending.get(cardId);
    if (next !== undefined) {
      this.pending.delete(cardId);
      this.enqueue(cardId, next);
    } else {
      this.pump();
    }
  }

  private async startStage(cardId: string, stage: PipelineStage): Promise<void> {
    // monitor é passivo (dirigido por webhook): nunca executa um agente.
    if (stage === "monitor") {
      await pipelineManager.parkAtMonitorGate(cardId).catch(() => {});
      this.releaseSlot(cardId);
      return;
    }

    const card = await pipelineManager.getCard(cardId);
    if (!card) { this.releaseSlot(cardId); return; }

    const pipeline = await pipelineManager.getPipeline(card.pipelineId);
    if (!pipeline) { this.releaseSlot(cardId); return; }

    const cfg = await pipelineManager.getStageConfig(pipeline.id, stage);
    if (!cfg) { this.releaseSlot(cardId); return; }

    await pipelineManager.ensureCardWorktrees(card);
    // Re-lê o card após criar as worktrees (lazy) para o prompt enxergar branch/worktree_path atualizados.
    const fresh = (await pipelineManager.getCard(cardId)) ?? card;

    const cwd = cardWorktreeRoot(cardId);
    mkdirSync(resolve(cwd, EVIDENCE_SUBDIR), { recursive: true });

    const attempt = (await pipelineManager.getCountForCardStage(cardId, stage)) + 1;
    const prompt = this.buildStagePrompt(fresh, pipeline.projectName, stage, cfg.promptTemplate, cwd);
    const run = await pipelineManager.createRun({ cardId, stage, attempt, promptSent: prompt });
    await pipelineManager.markRunning(cardId);

    const mcp = createPipelineMcpServer({ runId: run.id, cardId, pipelineId: pipeline.id, stage });

    // Modelo por card: só se aplica ao provider nativo "anthropic" (mesmo gating do modelo por
    // projeto); em gateway o override é ignorado e o modelo é resolvido pelo perfil ativo.
    const model = card.model && settingsManager.getActiveProfile().id === "anthropic" ? card.model : undefined;

    const execId = executionManager.startExecution({
      source: "pipeline",
      targetType: "project",
      targetName: pipeline.projectName,
      prompt,
      cwd,
      // Pipeline roda sem supervisão: auto mode sempre ligado para nunca travar em prompt de permissão.
      autoApprove: true,
      username: `pipeline:${cardId}`,
      resumeSessionId: card.sessionId ?? null,
      skills: cfg.skill ? [cfg.skill] : undefined,
      agentName: cfg.agentName ?? undefined,
      model,
      extraMcpServers: { pipeline: mcp },
      timeoutMs: resolveTimeoutMs(cfg.timeoutMs, config.pipelineStageTimeoutMs),
    });

    await pipelineManager.updateRun(run.id, { execId });
    this.execMap.set(execId, { runId: run.id, cardId, stage });
  }

  private buildStagePrompt(card: PipelineCard, projectName: string, stage: PipelineStage, template: string, cwd: string): string {
    const parts: string[] = [template];
    parts.push(`## Card ${projectName}#${card.seqNumber}: ${card.title}`);
    if (card.intakeInput) parts.push(`## Entrada de captação\n${card.intakeInput}`);
    if (card.requirementText) parts.push(`## Requisito\n${card.requirementText}`);
    if (card.planMarkdown) parts.push(`## Plano\n${card.planMarkdown}`);

    const worktrees = card.repos.filter((r) => r.worktreePath);
    if (worktrees.length > 0) {
      const lines = worktrees.map((r) => `- ${r.repoName}: ${r.worktreePath} (branch ${r.branch}, base ${r.baseBranch})`);
      parts.push(`## Worktrees (edite/teste o código aqui)\n${lines.join("\n")}`);
    }

    if (stage === "plan") {
      parts.push(buildPlanReposInstruction(card.repos.map((r) => r.repoName)));
    }

    if (stage === "e2e") {
      parts.push(`## Diretório de evidências\nSalve screenshots e logs do E2E em: ${resolve(cwd, EVIDENCE_SUBDIR)}\nReporte apenas os nomes dos arquivos (basename) em report_e2e.`);
    }

    if (stage === "pull_request") {
      const open = card.repos.filter((r) => r.prUrl);
      if (open.length > 0) {
        const lines = open.map((r) => `- ${r.repoName}: ${r.prUrl} (#${r.prNumber})`);
        parts.push(`## PRs já abertos — ATUALIZE via push na mesma branch, NÃO crie outro PR para estes repos\n${lines.join("\n")}\nAinda assim chame report_pull_request para cada repo (com o PR existente ou o novo).`);
      }
    }

    if (card.lastFeedback) parts.push(`## FEEDBACK A TRATAR (prioridade)\n${card.lastFeedback}`);

    const reportTool = REPORT_TOOL[stage];
    const reminder = reportTool
      ? `Ao concluir esta etapa (${stage}), você DEVE chamar a tool ${reportTool} com os dados estruturados — é assim que o resultado é registrado.`
      : `Esta etapa (${stage}) é de acompanhamento.`;
    parts.push(`[SYSTEM: ${reminder} Antes de agir, consulte mcp__memory__search_memory por features relacionadas (já feitas ou em andamento) neste projeto para manter coerência.]`);

    return parts.join("\n\n");
  }

  private deriveRunStatus(stage: PipelineStage, artifacts: StageArtifacts, isError: boolean): RunStatus {
    if (isError) return "error";
    switch (stage) {
      case "requirement": return artifacts.requirement ? "passed" : "failed";
      case "plan": return artifacts.plan ? "passed" : "failed";
      case "implementation": return artifacts.tests?.passed === true ? "passed" : "failed";
      case "code_review": return artifacts.review?.clean === true && artifacts.review?.testsPass === true ? "passed" : "failed";
      case "e2e": return artifacts.e2e?.passed === true ? "passed" : "failed";
      case "pull_request": return artifacts.prs && artifacts.prs.length > 0 ? "passed" : "failed";
      default: return "passed";
    }
  }

  private collectEvidence(cwd: string, runId: string, screenshots: string[]): string[] {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    const evidenceDir = resolve(cwd, EVIDENCE_SUBDIR);
    const flat: string[] = [];
    for (const [i, name] of screenshots.entries()) {
      const base = basename(name);
      const src = resolve(evidenceDir, base);
      if (!src.startsWith(evidenceDir) || !existsSync(src)) continue;
      const flatName = `pipeline-${runId}-${i}-${base}`;
      try {
        copyFileSync(src, resolve(UPLOADS_DIR, flatName));
        flat.push(flatName);
      } catch (err) {
        console.error(`[pipeline-runner] failed to collect evidence ${base}:`, err);
      }
    }
    return flat;
  }

  private async handleStageDone(mapping: RunMapping, info: ExecutionInfo, isError: boolean): Promise<void> {
    try {
      const sessionId = info.result?.sessionId ?? null;
      if (sessionId) await pipelineManager.updateCard(mapping.cardId, { sessionId });

      const run = await pipelineManager.getRun(mapping.runId);
      let artifacts = run?.artifacts ?? {};

      if (!isError && mapping.stage === "e2e" && artifacts.e2e?.screenshots?.length) {
        const cwd = cardWorktreeRoot(mapping.cardId);
        const flat = this.collectEvidence(cwd, mapping.runId, artifacts.e2e.screenshots);
        const e2e = { ...artifacts.e2e, screenshots: flat };
        await pipelineManager.mergeRunArtifacts(mapping.runId, { e2e });
        artifacts = { ...artifacts, e2e };
      }

      const status = this.deriveRunStatus(mapping.stage, artifacts, isError);
      const output = (info.output || "").slice(0, MAX_RUN_OUTPUT);
      const live = this.liveUsage.get(info.id)?.value;
      const costUsd = info.result?.costUsd ?? live?.costUsd ?? 0;
      const totalTokens = info.result?.totalTokens ?? live?.totalTokens ?? 0;
      const contextPct = live?.contextPct ?? 0;
      await pipelineManager.updateRun(mapping.runId, { sessionId, output, status, finished: true, costUsd, totalTokens, contextPct });

      executionManager.clearSessionId(info.targetType, info.targetName, info.username ?? `pipeline:${mapping.cardId}`);

      // O lock por-card é mantido por TODA a handleStageDone (incluindo onStageResult): a próxima
      // etapa emitida em onStageResult fica pendente e é drenada em releaseSlot, garantindo que
      // nunca rode mais de uma etapa do mesmo card ao mesmo tempo.
      await pipelineManager.onStageResult(mapping.cardId, mapping.runId);
    } finally {
      this.liveUsage.delete(info.id);
      this.releaseSlot(mapping.cardId);
    }
  }

  async recoverStaleRuns(): Promise<void> {
    try {
      const rows = await query<RowDataPacket[]>("SELECT id, card_id FROM pipeline_stage_runs WHERE status = 'running'");
      for (const row of rows) {
        await execute("UPDATE pipeline_stage_runs SET status = 'error', finished_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]).catch(() => {});
        await execute("UPDATE pipeline_cards SET status = 'failed' WHERE id = ? AND status = 'running'", [row.card_id]).catch(() => {});
      }
      if (rows.length > 0) console.log(`[pipeline-runner] Recovered ${rows.length} stale run(s) -> error`);
    } catch {
      // tables may not exist yet on first run
    }
  }

  async sweepOrphanWorktrees(): Promise<void> {
    try {
      if (!existsSync(PIPELINE_WORKTREES_ROOT)) return;
      const dirs = readdirSync(PIPELINE_WORKTREES_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
      if (dirs.length === 0) return;
      const placeholders = dirs.map(() => "?").join(",");
      const live = await query<RowDataPacket[]>(`SELECT id FROM pipeline_cards WHERE id IN (${placeholders})`, dirs);
      const liveSet = new Set(live.map((r) => r.id));
      let removed = 0;
      for (const dir of dirs) {
        if (liveSet.has(dir)) continue;
        await rm(resolve(PIPELINE_WORKTREES_ROOT, dir), { recursive: true, force: true }).catch(() => {});
        removed++;
      }
      if (removed > 0) console.log(`[pipeline-runner] Removed ${removed} orphan worktree dir(s)`);
    } catch {
      // best-effort
    }
  }
}

export const pipelineRunner = new PipelineRunner();

export function signPipelineScreenshots(artifacts: StageArtifacts): StageArtifacts {
  if (!artifacts.e2e?.screenshots?.length) return artifacts;
  return {
    ...artifacts,
    e2e: { ...artifacts.e2e, screenshots: artifacts.e2e.screenshots.map((f) => signUploadUrl(f)) },
  };
}

export async function initPipelineRunner(): Promise<void> {
  pipelineRunner.init();
  await pipelineRunner.recoverStaleRuns();
  await pipelineRunner.sweepOrphanWorktrees();
}
