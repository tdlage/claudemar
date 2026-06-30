import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import type { RowDataPacket } from "mysql2/promise";
import { query, execute, getPool } from "./database.js";
import { config } from "./config.js";
import { safeProjectPath } from "./session.js";
import { discoverRepos, resolveRepoPath } from "./repositories.js";
import { executeSpawn } from "./executor.js";
import {
  cardRepoWorktreePath,
  cardWorktreeRoot,
  ensureWorktree,
  pipelineBranchName,
  removeCardWorktreeRoot,
  removeWorktree,
} from "./pipeline-worktree.js";
import {
  DEFAULT_STAGE_CONFIGS,
  STAGE_ORDER,
  SKIPPABLE_STAGES,
  firstActiveStageIndex,
  sanitizeSkippedStages,
  validateSkippedStages,
  type IntakePluginType,
  type PipelineStage,
} from "./pipeline-migration.js";
import { aggregateCardUsage, EMPTY_CARD_USAGE, type CardUsage, type UsageRunInput } from "./pipeline-usage.js";
import { installPipelineCron, removePipelineCron } from "./pipeline-cron.js";

export type CardStatus = "idle" | "running" | "awaiting_gate" | "failed" | "done";
export type RunStatus = "running" | "passed" | "failed" | "error" | "cancelled";
export type RepoStatus = "pending" | "worktree" | "pushed" | "pr_open" | "merged" | "closed";

export interface StageArtifacts {
  requirement?: string;
  plan?: { markdown: string; repos: string[] };
  tests?: { passed: boolean; total: number; failed: number; logs?: string };
  review?: { totalFindings: number; fixed: number; clean: boolean; testsPass: boolean; summary?: string };
  e2e?: { passed: boolean; screenshots: string[]; logs?: string };
  prs?: { repo: string; url: string; number: number }[];
  items?: { title: string; input: string }[];
}

export interface Pipeline {
  id: string;
  projectName: string;
  defaultBaseBranch: string;
  nextCardNumber: number;
  defaultAuto: boolean;
  createdBy: string;
  createdAt: string;
}

export interface PipelineStageConfig {
  id: string;
  pipelineId: string;
  stage: PipelineStage;
  promptTemplate: string;
  skill: string | null;
  agentName: string | null;
  timeoutMs: number;
}

export interface PipelineIntakePlugin {
  id: string;
  pipelineId: string;
  type: IntakePluginType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  cron: string | null;
  scheduleId: string | null;
  createdAt: string;
}

export interface PipelineCardRepo {
  id: string;
  cardId: string;
  repoName: string;
  baseBranch: string;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  prNumber: number | null;
  repoStatus: RepoStatus;
}

export interface PipelineCard {
  id: string;
  pipelineId: string;
  seqNumber: number;
  title: string;
  stage: PipelineStage;
  status: CardStatus;
  auto: boolean;
  originType: IntakePluginType;
  originRef: string | null;
  intakeInput: string;
  requirementText: string;
  planMarkdown: string;
  sessionId: string | null;
  implementationRetries: number;
  codeReviewRetries: number;
  e2eRetries: number;
  position: number;
  lastFeedback: string | null;
  skippedStages: PipelineStage[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  repos: PipelineCardRepo[];
  totalCostUsd: number;
  totalTokens: number;
  contextPct: number;
}

export interface RunUsage {
  costUsd: number;
  totalTokens: number;
  contextPct: number;
}

export interface RunUsageEvent {
  cardId: string;
  runId: string;
  run: RunUsage;
  card: CardUsage;
}

export interface PipelineStageRun {
  id: string;
  cardId: string;
  stage: PipelineStage;
  attempt: number;
  execId: string | null;
  sessionId: string | null;
  status: RunStatus;
  promptSent: string;
  output: string;
  artifacts: StageArtifacts;
  costUsd: number;
  totalTokens: number;
  contextPct: number;
  startedAt: string;
  finishedAt: string | null;
}

interface PipelineRow extends RowDataPacket {
  id: string;
  project_name: string;
  default_base_branch: string;
  next_card_number: number;
  default_auto: number;
  created_by: string;
  created_at: string;
}

interface StageConfigRow extends RowDataPacket {
  id: string;
  pipeline_id: string;
  stage: string;
  prompt_template: string;
  skill: string | null;
  agent_name: string | null;
  timeout_ms: number;
}

interface IntakePluginRow extends RowDataPacket {
  id: string;
  pipeline_id: string;
  type: string;
  name: string;
  config: string;
  enabled: number;
  cron: string | null;
  schedule_id: string | null;
  created_at: string;
}

interface CardRepoRow extends RowDataPacket {
  id: string;
  card_id: string;
  repo_name: string;
  base_branch: string;
  branch: string | null;
  worktree_path: string | null;
  pr_url: string | null;
  pr_number: number | null;
  repo_status: string;
}

interface CardRow extends RowDataPacket {
  id: string;
  pipeline_id: string;
  seq_number: number;
  title: string;
  stage: string;
  status: string;
  auto: number;
  origin_type: string;
  origin_ref: string | null;
  intake_input: string | null;
  requirement_text: string | null;
  plan_markdown: string | null;
  session_id: string | null;
  implementation_retries: number;
  code_review_retries: number;
  e2e_retries: number;
  position: number;
  last_feedback: string | null;
  skipped_stages: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface StageRunRow extends RowDataPacket {
  id: string;
  card_id: string;
  stage: string;
  attempt: number;
  exec_id: string | null;
  session_id: string | null;
  status: string;
  prompt_sent: string | null;
  output: string | null;
  artifacts: string | null;
  cost_usd: string | number | null;
  total_tokens: string | number | null;
  context_pct: string | number | null;
  started_at: string;
  finished_at: string | null;
}

function iso(v: string): string {
  return new Date(v).toISOString();
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as T);
  } catch {
    return fallback;
  }
}

function mapPipeline(r: PipelineRow): Pipeline {
  return {
    id: r.id,
    projectName: r.project_name,
    defaultBaseBranch: r.default_base_branch,
    nextCardNumber: r.next_card_number,
    defaultAuto: r.default_auto === 1,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  };
}

function mapStageConfig(r: StageConfigRow): PipelineStageConfig {
  return {
    id: r.id,
    pipelineId: r.pipeline_id,
    stage: r.stage as PipelineStage,
    promptTemplate: r.prompt_template,
    skill: r.skill,
    agentName: r.agent_name,
    timeoutMs: r.timeout_ms,
  };
}

function mapIntakePlugin(r: IntakePluginRow): PipelineIntakePlugin {
  return {
    id: r.id,
    pipelineId: r.pipeline_id,
    type: r.type as IntakePluginType,
    name: r.name,
    config: parseJson<Record<string, unknown>>(r.config, {}),
    enabled: r.enabled === 1,
    cron: r.cron,
    scheduleId: r.schedule_id,
    createdAt: iso(r.created_at),
  };
}

function mapCardRepo(r: CardRepoRow): PipelineCardRepo {
  return {
    id: r.id,
    cardId: r.card_id,
    repoName: r.repo_name,
    baseBranch: r.base_branch,
    branch: r.branch,
    worktreePath: r.worktree_path,
    prUrl: r.pr_url,
    prNumber: r.pr_number,
    repoStatus: r.repo_status as RepoStatus,
  };
}

function mapCard(r: CardRow, repos: PipelineCardRepo[], usage: CardUsage = EMPTY_CARD_USAGE): PipelineCard {
  return {
    id: r.id,
    pipelineId: r.pipeline_id,
    seqNumber: r.seq_number,
    title: r.title,
    stage: r.stage as PipelineStage,
    status: r.status as CardStatus,
    auto: r.auto === 1,
    originType: r.origin_type as IntakePluginType,
    originRef: r.origin_ref,
    intakeInput: r.intake_input || "",
    requirementText: r.requirement_text || "",
    planMarkdown: r.plan_markdown || "",
    sessionId: r.session_id,
    implementationRetries: r.implementation_retries,
    codeReviewRetries: r.code_review_retries,
    e2eRetries: r.e2e_retries,
    position: r.position,
    lastFeedback: r.last_feedback,
    skippedStages: sanitizeSkippedStages(parseJson<unknown>(r.skipped_stages, [])),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    repos,
    totalCostUsd: usage.totalCostUsd,
    totalTokens: usage.totalTokens,
    contextPct: usage.contextPct,
  };
}

function mapStageRun(r: StageRunRow): PipelineStageRun {
  return {
    id: r.id,
    cardId: r.card_id,
    stage: r.stage as PipelineStage,
    attempt: r.attempt,
    execId: r.exec_id,
    sessionId: r.session_id,
    status: r.status as RunStatus,
    promptSent: r.prompt_sent || "",
    output: r.output || "",
    artifacts: parseJson<StageArtifacts>(r.artifacts, {}),
    costUsd: Number(r.cost_usd ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    contextPct: Number(r.context_pct ?? 0),
    startedAt: iso(r.started_at),
    finishedAt: r.finished_at ? iso(r.finished_at) : null,
  };
}

type RetryField = "implementation_retries" | "code_review_retries" | "e2e_retries";

class PipelineManager extends EventEmitter {
  // ── Pipelines ──

  async getPipeline(id: string): Promise<Pipeline | null> {
    const rows = await query<PipelineRow[]>("SELECT * FROM pipeline_pipelines WHERE id = ?", [id]);
    return rows[0] ? mapPipeline(rows[0]) : null;
  }

  async getPipelineByProject(projectName: string): Promise<Pipeline | null> {
    const rows = await query<PipelineRow[]>("SELECT * FROM pipeline_pipelines WHERE project_name = ?", [projectName]);
    return rows[0] ? mapPipeline(rows[0]) : null;
  }

  async createPipeline(data: { projectName: string; defaultBaseBranch?: string; createdBy: string }): Promise<Pipeline> {
    const id = randomUUID();
    await execute(
      "INSERT INTO pipeline_pipelines (id, project_name, default_base_branch, created_by) VALUES (?, ?, ?, ?)",
      [id, data.projectName, data.defaultBaseBranch || "main", data.createdBy],
    );
    for (const cfg of DEFAULT_STAGE_CONFIGS) {
      await execute(
        "INSERT INTO pipeline_stage_configs (id, pipeline_id, stage, prompt_template, skill, agent_name) VALUES (?, ?, ?, ?, ?, ?)",
        [randomUUID(), id, cfg.stage, cfg.promptTemplate, cfg.skill, cfg.agentName],
      );
    }
    const pipeline = (await this.getPipeline(id))!;
    this.emit("pipeline:update", pipeline);
    return pipeline;
  }

  async updatePipeline(id: string, data: Partial<{ defaultBaseBranch: string; defaultAuto: boolean }>): Promise<Pipeline | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.defaultBaseBranch !== undefined) { sets.push("default_base_branch = ?"); params.push(data.defaultBaseBranch); }
    if (data.defaultAuto !== undefined) { sets.push("default_auto = ?"); params.push(data.defaultAuto ? 1 : 0); }
    if (sets.length === 0) return this.getPipeline(id);
    params.push(id);
    await execute(`UPDATE pipeline_pipelines SET ${sets.join(", ")} WHERE id = ?`, params);
    const pipeline = await this.getPipeline(id);
    if (pipeline) this.emit("pipeline:update", pipeline);
    return pipeline;
  }

  // ── Stage configs ──

  async getStageConfigs(pipelineId: string): Promise<PipelineStageConfig[]> {
    const rows = await query<StageConfigRow[]>("SELECT * FROM pipeline_stage_configs WHERE pipeline_id = ?", [pipelineId]);
    return rows.map(mapStageConfig);
  }

  async getStageConfig(pipelineId: string, stage: PipelineStage): Promise<PipelineStageConfig | null> {
    const rows = await query<StageConfigRow[]>("SELECT * FROM pipeline_stage_configs WHERE pipeline_id = ? AND stage = ?", [pipelineId, stage]);
    return rows[0] ? mapStageConfig(rows[0]) : null;
  }

  async updateStageConfig(pipelineId: string, stage: PipelineStage, data: Partial<{ promptTemplate: string; skill: string | null; agentName: string | null; timeoutMs: number }>): Promise<PipelineStageConfig | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.promptTemplate !== undefined) { sets.push("prompt_template = ?"); params.push(data.promptTemplate); }
    if (data.skill !== undefined) { sets.push("skill = ?"); params.push(data.skill || null); }
    if (data.agentName !== undefined) { sets.push("agent_name = ?"); params.push(data.agentName || null); }
    if (data.timeoutMs !== undefined) { sets.push("timeout_ms = ?"); params.push(data.timeoutMs); }
    if (sets.length === 0) return this.getStageConfig(pipelineId, stage);
    params.push(pipelineId, stage);
    await execute(`UPDATE pipeline_stage_configs SET ${sets.join(", ")} WHERE pipeline_id = ? AND stage = ?`, params);
    const cfg = await this.getStageConfig(pipelineId, stage);
    if (cfg) {
      const pipeline = await this.getPipeline(pipelineId);
      if (pipeline) this.emit("pipeline:update", pipeline);
    }
    return cfg;
  }

  // ── Intake plugins ──

  async listIntakePlugins(pipelineId: string): Promise<PipelineIntakePlugin[]> {
    const rows = await query<IntakePluginRow[]>("SELECT * FROM pipeline_intake_plugins WHERE pipeline_id = ? ORDER BY created_at", [pipelineId]);
    return rows.map(mapIntakePlugin);
  }

  async getIntakePlugin(id: string): Promise<PipelineIntakePlugin | null> {
    const rows = await query<IntakePluginRow[]>("SELECT * FROM pipeline_intake_plugins WHERE id = ?", [id]);
    return rows[0] ? mapIntakePlugin(rows[0]) : null;
  }

  async createIntakePlugin(data: { pipelineId: string; type: IntakePluginType; name: string; config?: Record<string, unknown>; enabled?: boolean; cron?: string | null }): Promise<PipelineIntakePlugin> {
    const id = randomUUID();
    await execute(
      "INSERT INTO pipeline_intake_plugins (id, pipeline_id, type, name, config, enabled, cron) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, data.pipelineId, data.type, data.name, JSON.stringify(data.config || {}), data.enabled === false ? 0 : 1, data.cron || null],
    );
    const plugin = (await this.getIntakePlugin(id))!;
    if (plugin.enabled && plugin.cron) {
      try { installPipelineCron(plugin.id, plugin.cron); } catch (err) { console.error("[pipeline] cron install failed:", err); }
    }
    this.emit("plugin:create", plugin);
    return plugin;
  }

  async updateIntakePlugin(id: string, data: Partial<{ name: string; config: Record<string, unknown>; enabled: boolean; cron: string | null }>): Promise<PipelineIntakePlugin | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); params.push(data.name); }
    if (data.config !== undefined) { sets.push("config = ?"); params.push(JSON.stringify(data.config)); }
    if (data.enabled !== undefined) { sets.push("enabled = ?"); params.push(data.enabled ? 1 : 0); }
    if (data.cron !== undefined) { sets.push("cron = ?"); params.push(data.cron || null); }
    if (sets.length === 0) return this.getIntakePlugin(id);
    params.push(id);
    await execute(`UPDATE pipeline_intake_plugins SET ${sets.join(", ")} WHERE id = ?`, params);
    const plugin = await this.getIntakePlugin(id);
    if (plugin) {
      if (plugin.enabled && plugin.cron) {
        try { installPipelineCron(plugin.id, plugin.cron); } catch (err) { console.error("[pipeline] cron install failed:", err); }
      } else {
        removePipelineCron(plugin.id);
      }
      this.emit("plugin:update", plugin);
    }
    return plugin;
  }

  async deleteIntakePlugin(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM pipeline_intake_plugins WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      removePipelineCron(id);
      this.emit("plugin:delete", { id });
      return true;
    }
    return false;
  }

  // ── Card repos ──

  async getCardRepos(cardId: string): Promise<PipelineCardRepo[]> {
    const rows = await query<CardRepoRow[]>("SELECT * FROM pipeline_card_repos WHERE card_id = ? ORDER BY repo_name", [cardId]);
    return rows.map(mapCardRepo);
  }

  private async getReposForCards(cardIds: string[]): Promise<Map<string, PipelineCardRepo[]>> {
    const map = new Map<string, PipelineCardRepo[]>();
    if (cardIds.length === 0) return map;
    const placeholders = cardIds.map(() => "?").join(",");
    const rows = await query<CardRepoRow[]>(`SELECT * FROM pipeline_card_repos WHERE card_id IN (${placeholders}) ORDER BY repo_name`, cardIds);
    for (const r of rows) {
      const list = map.get(r.card_id) || [];
      list.push(mapCardRepo(r));
      map.set(r.card_id, list);
    }
    return map;
  }

  async upsertCardRepo(cardId: string, repoName: string, baseBranch: string): Promise<void> {
    const existing = await query<CardRepoRow[]>("SELECT id FROM pipeline_card_repos WHERE card_id = ? AND repo_name = ?", [cardId, repoName]);
    if (existing[0]) return;
    await execute("INSERT INTO pipeline_card_repos (id, card_id, repo_name, base_branch) VALUES (?, ?, ?, ?)", [randomUUID(), cardId, repoName, baseBranch]);
    await this.emitCard(cardId);
  }

  async setCardRepoPr(cardId: string, repoName: string, url: string, prNumber: number): Promise<boolean> {
    const result = await execute("UPDATE pipeline_card_repos SET pr_url = ?, pr_number = ?, repo_status = 'pr_open' WHERE card_id = ? AND repo_name = ?", [url, prNumber, cardId, repoName]);
    if (result.affectedRows > 0) await this.emitCard(cardId);
    return result.affectedRows > 0;
  }

  // ── Cards ──

  private async attachRepos(rows: CardRow[]): Promise<PipelineCard[]> {
    const ids = rows.map((r) => r.id);
    const [reposMap, usageMap] = await Promise.all([this.getReposForCards(ids), this.getCardUsageMap(ids)]);
    return rows.map((r) => mapCard(r, reposMap.get(r.id) || [], usageMap.get(r.id)));
  }

  async getCardsByPipeline(pipelineId: string): Promise<PipelineCard[]> {
    const rows = await query<CardRow[]>("SELECT * FROM pipeline_cards WHERE pipeline_id = ? ORDER BY position, created_at", [pipelineId]);
    return this.attachRepos(rows);
  }

  async getCard(id: string): Promise<PipelineCard | null> {
    const rows = await query<CardRow[]>("SELECT * FROM pipeline_cards WHERE id = ?", [id]);
    if (!rows[0]) return null;
    const [repos, usage] = await Promise.all([this.getCardRepos(id), this.getCardUsage(id)]);
    return mapCard(rows[0], repos, usage);
  }

  async createCard(data: {
    pipelineId: string;
    title: string;
    intakeInput?: string;
    originType?: IntakePluginType;
    originRef?: string;
    auto?: boolean;
    repos?: string[];
    baseBranch?: string;
    createdBy: string;
  }): Promise<PipelineCard> {
    const pipeline = await this.getPipeline(data.pipelineId);
    if (!pipeline) throw new Error("Pipeline not found");

    const projectPath = safeProjectPath(pipeline.projectName);
    if (!projectPath) throw new Error("Project not found");

    let repoNames = data.repos?.filter((r) => r.trim().length > 0) ?? [];
    if (repoNames.length === 0) {
      const discovered = await discoverRepos(projectPath);
      repoNames = discovered.map((r) => r.name);
    }
    if (repoNames.length === 0) throw new Error("Projeto não possui repositórios git");

    const id = randomUUID();
    const baseBranch = data.baseBranch || pipeline.defaultBaseBranch;

    const maxPos = await query<RowDataPacket[]>("SELECT COALESCE(MAX(position), -1) AS mp FROM pipeline_cards WHERE pipeline_id = ?", [data.pipelineId]);
    const position = (maxPos[0]?.mp ?? -1) + 1;

    const conn = await getPool().getConnection();
    let seqNumber: number;
    try {
      await conn.execute("UPDATE pipeline_pipelines SET next_card_number = LAST_INSERT_ID(next_card_number), next_card_number = next_card_number + 1 WHERE id = ?", [data.pipelineId]);
      const [seqRows] = await conn.execute<RowDataPacket[]>("SELECT LAST_INSERT_ID() AS seq");
      seqNumber = seqRows[0]?.seq ?? 1;
    } finally {
      conn.release();
    }

    await execute(
      `INSERT INTO pipeline_cards (id, pipeline_id, seq_number, title, stage, status, auto, origin_type, origin_ref, intake_input, position, created_by)
       VALUES (?, ?, ?, ?, 'requirement', 'idle', ?, ?, ?, ?, ?, ?)`,
      [id, data.pipelineId, seqNumber, data.title, data.auto ? 1 : 0, data.originType || "manual", data.originRef || null, data.intakeInput || "", position, data.createdBy],
    );

    for (const repoName of repoNames) {
      await execute("INSERT INTO pipeline_card_repos (id, card_id, repo_name, base_branch) VALUES (?, ?, ?, ?)", [randomUUID(), id, repoName, baseBranch]);
    }

    const card = (await this.getCard(id))!;
    this.emit("card:create", card);
    // Worktrees são criadas preguiçosamente no início da 1ª etapa (runner.startStage), evitando
    // operações git pesadas na criação do card (inclusive intake propondo muitos cards de uma vez).
    if (card.auto) this.emit("stage:request", { cardId: id, stage: "requirement" as PipelineStage });
    return card;
  }

  async updateCard(id: string, data: Partial<{ title: string; requirementText: string; planMarkdown: string; sessionId: string | null; intakeInput: string }>): Promise<PipelineCard | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.title !== undefined) { sets.push("title = ?"); params.push(data.title); }
    if (data.requirementText !== undefined) { sets.push("requirement_text = ?"); params.push(data.requirementText); }
    if (data.planMarkdown !== undefined) { sets.push("plan_markdown = ?"); params.push(data.planMarkdown); }
    if (data.sessionId !== undefined) { sets.push("session_id = ?"); params.push(data.sessionId); }
    if (data.intakeInput !== undefined) { sets.push("intake_input = ?"); params.push(data.intakeInput); }
    if (sets.length === 0) return this.getCard(id);
    params.push(id);
    await execute(`UPDATE pipeline_cards SET ${sets.join(", ")} WHERE id = ?`, params);
    return this.emitCard(id);
  }

  async setAuto(id: string, auto: boolean): Promise<PipelineCard | null> {
    await execute("UPDATE pipeline_cards SET auto = ? WHERE id = ?", [auto ? 1 : 0, id]);
    const card = await this.emitCard(id);
    if (card && auto && card.status === "awaiting_gate" && card.stage !== "monitor") {
      await execute("UPDATE pipeline_cards SET status = 'idle' WHERE id = ?", [id]);
      await this.emitCard(id);
      this.emit("stage:request", { cardId: id, stage: card.stage });
    }
    return card;
  }

  async setSkippedStages(id: string, input: unknown): Promise<PipelineCard | null> {
    const card = await this.getCard(id);
    if (!card) return null;
    if (card.status === "running") throw new Error("Não é possível alterar etapas de um card em execução");

    const finalStages = validateSkippedStages(input);
    const requested = new Set(finalStages);
    const previous = new Set(card.skippedStages);
    const curIdx = STAGE_ORDER.indexOf(card.stage);
    // Guarda de histórico: etapas já ultrapassadas não podem ter o skip alterado.
    for (const stage of SKIPPABLE_STAGES) {
      if (STAGE_ORDER.indexOf(stage) < curIdx && requested.has(stage) !== previous.has(stage)) {
        throw new Error(`A etapa "${stage}" já foi ultrapassada e não pode ser alterada`);
      }
    }

    await execute("UPDATE pipeline_cards SET skipped_stages = ? WHERE id = ?", [JSON.stringify(finalStages), id]);
    const updated: PipelineCard = { ...card, skippedStages: finalStages };
    // Se a etapa atual passou a ser pulada (e o card não está concluído), reposiciona para a próxima ativa.
    if (updated.status !== "done" && requested.has(updated.stage)) {
      return this.normalizeSkippedStage(updated);
    }
    return this.emitCard(id);
  }

  // Move um card cuja etapa atual ficou pulada para a primeira etapa ativa (sem executá-la aqui),
  // preservando o status de repouso (awaiting_gate continua no gate; idle/failed viram idle).
  private async normalizeSkippedStage(card: PipelineCard): Promise<PipelineCard | null> {
    const targetIdx = firstActiveStageIndex(STAGE_ORDER.indexOf(card.stage), new Set(card.skippedStages));
    if (targetIdx === -1) {
      await this.setCardStatus(card.id, "done");
      return this.getCard(card.id);
    }
    const manualStatus: CardStatus = card.status === "awaiting_gate" ? "awaiting_gate" : "idle";
    return this.moveToStage(card, STAGE_ORDER[targetIdx], manualStatus);
  }

  async deleteCard(id: string): Promise<boolean> {
    const card = await this.getCard(id);
    if (!card) return false;
    if (card.status === "running") return false;
    await this.removeCardWorktrees(card);
    const result = await execute("DELETE FROM pipeline_cards WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("card:delete", { id, pipelineId: card.pipelineId });
      return true;
    }
    return false;
  }

  async setCardRepos(id: string, repoNames: string[]): Promise<PipelineCard | null> {
    const card = await this.getCard(id);
    if (!card) return null;
    const pipeline = await this.getPipeline(card.pipelineId);
    const baseBranch = pipeline?.defaultBaseBranch || "main";
    const keep = new Set(repoNames);
    for (const repo of card.repos) {
      if (!keep.has(repo.repoName)) {
        const projectPath = pipeline ? safeProjectPath(pipeline.projectName) : null;
        if (repo.worktreePath && projectPath) {
          const repoPath = resolveRepoPath(projectPath, repo.repoName);
          if (repoPath) await removeWorktree(repoPath, repo.worktreePath, repo.branch);
        }
        await execute("DELETE FROM pipeline_card_repos WHERE id = ?", [repo.id]);
      }
    }
    const existing = new Set(card.repos.map((r) => r.repoName));
    for (const name of repoNames) {
      if (!existing.has(name)) {
        await execute("INSERT INTO pipeline_card_repos (id, card_id, repo_name, base_branch) VALUES (?, ?, ?, ?)", [randomUUID(), id, name, baseBranch]);
      }
    }
    return this.emitCard(id);
  }

  private async setCardStatus(id: string, status: CardStatus): Promise<void> {
    await execute("UPDATE pipeline_cards SET status = ? WHERE id = ?", [status, id]);
    await this.emitCard(id);
  }

  async markRunning(id: string): Promise<void> {
    await this.setCardStatus(id, "running");
  }

  private async emitCard(id: string): Promise<PipelineCard | null> {
    const card = await this.getCard(id);
    if (card) this.emit("card:update", card);
    return card;
  }

  // ── Worktrees ──

  async ensureCardWorktrees(card: PipelineCard): Promise<void> {
    const pipeline = await this.getPipeline(card.pipelineId);
    if (!pipeline) throw new Error("Pipeline not found");
    const projectPath = safeProjectPath(pipeline.projectName);
    if (!projectPath) throw new Error("Project not found");

    const repos = await this.getCardRepos(card.id);
    if (repos.length === 0) return;
    mkdirSync(cardWorktreeRoot(card.id), { recursive: true });

    let changed = false;
    for (const repo of repos) {
      if (repo.worktreePath && existsSync(resolve(repo.worktreePath, ".git"))) continue;
      const repoPath = resolveRepoPath(projectPath, repo.repoName);
      if (!repoPath) throw new Error(`Repositório não encontrado: ${repo.repoName}`);
      const branch = repo.branch ?? pipelineBranchName(card.seqNumber, card.title);
      const destPath = cardRepoWorktreePath(card.id, repo.repoName);
      await ensureWorktree(repoPath, repo.baseBranch, branch, destPath);
      await execute("UPDATE pipeline_card_repos SET branch = ?, worktree_path = ?, repo_status = 'worktree' WHERE id = ?", [branch, destPath, repo.id]);
      changed = true;
    }
    if (changed) await this.emitCard(card.id);
  }

  async removeCardWorktrees(card: PipelineCard): Promise<void> {
    const pipeline = await this.getPipeline(card.pipelineId);
    const projectPath = pipeline ? safeProjectPath(pipeline.projectName) : null;
    const repos = await this.getCardRepos(card.id);
    for (const repo of repos) {
      if (!repo.worktreePath) continue;
      const repoPath = projectPath ? resolveRepoPath(projectPath, repo.repoName) : null;
      if (repoPath) await removeWorktree(repoPath, repo.worktreePath, repo.branch);
    }
    await removeCardWorktreeRoot(card.id);
  }

  // ── Stage runs ──

  async getRunsByCard(cardId: string): Promise<PipelineStageRun[]> {
    const rows = await query<StageRunRow[]>("SELECT * FROM pipeline_stage_runs WHERE card_id = ? ORDER BY started_at", [cardId]);
    return rows.map(mapStageRun);
  }

  async getRun(id: string): Promise<PipelineStageRun | null> {
    const rows = await query<StageRunRow[]>("SELECT * FROM pipeline_stage_runs WHERE id = ?", [id]);
    return rows[0] ? mapStageRun(rows[0]) : null;
  }

  async getCardE2eScreenshots(cardId: string): Promise<string[]> {
    const runs = await this.getRunsByCard(cardId);
    for (let i = runs.length - 1; i >= 0; i--) {
      const shots = runs[i].stage === "e2e" ? runs[i].artifacts.e2e?.screenshots : undefined;
      if (shots && shots.length > 0) return shots;
    }
    return [];
  }

  async createRun(data: { cardId: string; stage: PipelineStage; attempt: number; promptSent: string }): Promise<PipelineStageRun> {
    const id = randomUUID();
    await execute(
      "INSERT INTO pipeline_stage_runs (id, card_id, stage, attempt, prompt_sent, status) VALUES (?, ?, ?, ?, ?, 'running')",
      [id, data.cardId, data.stage, data.attempt, data.promptSent],
    );
    const run = (await this.getRun(id))!;
    this.emit("run:create", run);
    return run;
  }

  async updateRun(id: string, data: Partial<{ execId: string; sessionId: string | null; status: RunStatus; output: string; finished: boolean; costUsd: number; totalTokens: number; contextPct: number }>): Promise<PipelineStageRun | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.execId !== undefined) { sets.push("exec_id = ?"); params.push(data.execId); }
    if (data.sessionId !== undefined) { sets.push("session_id = ?"); params.push(data.sessionId); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (data.output !== undefined) { sets.push("output = ?"); params.push(data.output); }
    if (data.costUsd !== undefined) { sets.push("cost_usd = ?"); params.push(data.costUsd); }
    if (data.totalTokens !== undefined) { sets.push("total_tokens = ?"); params.push(data.totalTokens); }
    if (data.contextPct !== undefined) { sets.push("context_pct = ?"); params.push(data.contextPct); }
    if (data.finished) { sets.push("finished_at = CURRENT_TIMESTAMP"); }
    if (sets.length === 0) return this.getRun(id);
    params.push(id);
    await execute(`UPDATE pipeline_stage_runs SET ${sets.join(", ")} WHERE id = ?`, params);
    const run = await this.getRun(id);
    if (run) this.emit("run:update", run);
    return run;
  }

  async mergeRunArtifacts(id: string, partial: Partial<StageArtifacts>): Promise<void> {
    const run = await this.getRun(id);
    if (!run) return;
    const merged = { ...run.artifacts, ...partial };
    await execute("UPDATE pipeline_stage_runs SET artifacts = ? WHERE id = ?", [JSON.stringify(merged), id]);
    const updated = await this.getRun(id);
    if (updated) this.emit("run:update", updated);
  }

  async getCountForCardStage(cardId: string, stage: PipelineStage): Promise<number> {
    const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS cnt FROM pipeline_stage_runs WHERE card_id = ? AND stage = ?", [cardId, stage]);
    return Number(rows[0]?.cnt ?? 0);
  }

  // ── Usage (custo/tokens/contexto agregados por card) ──

  // ORDER BY started_at, id garante ordem determinística: aggregateCardUsage escolhe o contextPct
  // da run de maior startedAt e o id desempata runs iniciadas no mesmo segundo (started_at é DATETIME).
  private async fetchUsageRows(cardIds: string[]): Promise<Map<string, (UsageRunInput & { runId: string })[]>> {
    const byCard = new Map<string, (UsageRunInput & { runId: string })[]>();
    if (cardIds.length === 0) return byCard;
    const placeholders = cardIds.map(() => "?").join(",");
    const rows = await query<RowDataPacket[]>(
      `SELECT id, card_id, status, cost_usd, total_tokens, context_pct, UNIX_TIMESTAMP(started_at) AS started
       FROM pipeline_stage_runs WHERE card_id IN (${placeholders}) ORDER BY started_at, id`,
      cardIds,
    );
    for (const r of rows) {
      const list = byCard.get(r.card_id) ?? [];
      list.push({
        runId: r.id,
        status: r.status,
        costUsd: Number(r.cost_usd ?? 0),
        totalTokens: Number(r.total_tokens ?? 0),
        contextPct: Number(r.context_pct ?? 0),
        startedAt: Number(r.started ?? 0),
      });
      byCard.set(r.card_id, list);
    }
    return byCard;
  }

  async getCardUsageMap(cardIds: string[]): Promise<Map<string, CardUsage>> {
    const byCard = await this.fetchUsageRows(cardIds);
    const map = new Map<string, CardUsage>();
    for (const id of cardIds) map.set(id, aggregateCardUsage(byCard.get(id) ?? []));
    return map;
  }

  async getCardUsage(cardId: string): Promise<CardUsage> {
    const map = await this.getCardUsageMap([cardId]);
    return map.get(cardId) ?? EMPTY_CARD_USAGE;
  }

  // Live: a run ativa ainda tem usage 0 persistido. Substitui esse registro pelos valores ao vivo e
  // reusa aggregateCardUsage — fonte única da regra de agregação (custo/tokens somam, contexto não).
  async emitRunUsage(cardId: string, runId: string, live: RunUsage): Promise<void> {
    const rows = (await this.fetchUsageRows([cardId])).get(cardId) ?? [];
    const inputs: UsageRunInput[] = rows.map((r) =>
      r.runId === runId ? { ...r, status: "running", ...live } : r,
    );
    const card = aggregateCardUsage(inputs);
    const event: RunUsageEvent = { cardId, runId, run: live, card };
    this.emit("run:usage", event);
  }

  // ── State machine ──

  async approveGate(cardId: string): Promise<boolean> {
    const card = await this.getCard(cardId);
    if (!card || card.status !== "awaiting_gate") return false;
    if (card.stage === "monitor") {
      await this.setCardStatus(cardId, "done");
      await this.removeCardWorktrees(card);
      return true;
    }
    await execute("UPDATE pipeline_cards SET status = 'idle' WHERE id = ?", [cardId]);
    await this.emitCard(cardId);
    this.emit("stage:request", { cardId, stage: card.stage });
    return true;
  }

  async retry(cardId: string): Promise<boolean> {
    const card = await this.getCard(cardId);
    if (!card || card.status === "running" || card.status === "done") return false;
    if (card.stage === "monitor") return false;
    await execute("UPDATE pipeline_cards SET status = 'idle' WHERE id = ?", [cardId]);
    await this.emitCard(cardId);
    this.emit("stage:request", { cardId, stage: card.stage });
    return true;
  }

  async sendBack(cardId: string, feedback: string): Promise<boolean> {
    const card = await this.getCard(cardId);
    if (!card || card.status === "running") return false;
    await execute("UPDATE pipeline_cards SET stage = 'implementation', status = 'idle', last_feedback = ? WHERE id = ?", [feedback || null, cardId]);
    await this.emitCard(cardId);
    this.emit("stage:request", { cardId, stage: "implementation" as PipelineStage });
    return true;
  }

  async rejectGate(cardId: string): Promise<boolean> {
    const card = await this.getCard(cardId);
    if (!card || card.status === "running") return false;
    await this.setCardStatus(cardId, "failed");
    return true;
  }

  // Falha forçada (uso interno do runner quando o startStage lança), sem o guard de 'running'.
  async failCard(cardId: string): Promise<void> {
    await this.setCardStatus(cardId, "failed");
  }

  // Estaciona o card no gate de monitor sem executar agente (monitor é passivo/webhook-driven).
  async parkAtMonitorGate(cardId: string): Promise<void> {
    await execute("UPDATE pipeline_cards SET stage = 'monitor', status = 'awaiting_gate' WHERE id = ?", [cardId]);
    await this.emitCard(cardId);
  }

  private async advanceCard(card: PipelineCard): Promise<void> {
    const nextIdx = firstActiveStageIndex(STAGE_ORDER.indexOf(card.stage) + 1, new Set(card.skippedStages));
    if (nextIdx === -1) {
      await this.setCardStatus(card.id, "done");
      return;
    }
    await this.moveToStage(card, STAGE_ORDER[nextIdx], "awaiting_gate");
  }

  // Entrada numa etapa: grava stage/status, limpa o feedback anterior, emite a atualização e
  // dispara a execução (autos) ou a liquidação do gate de monitor. monitor é passivo (o
  // acompanhamento de PR é dirigido por webhook), então mesmo autos param no gate ao chegar nele.
  // `manualStatus` define o status de repouso de cards não-automáticos.
  private async moveToStage(card: PipelineCard, target: PipelineStage, manualStatus: CardStatus): Promise<PipelineCard | null> {
    const autoRun = card.auto && target !== "monitor";
    const status: CardStatus = autoRun ? "idle" : card.auto ? "awaiting_gate" : manualStatus;
    await execute(
      "UPDATE pipeline_cards SET stage = ?, last_feedback = NULL, status = ? WHERE id = ?",
      [target, status, card.id],
    );
    const updated = await this.emitCard(card.id);
    if (autoRun) this.emit("stage:request", { cardId: card.id, stage: target });
    else if (card.auto && target === "monitor") await this.settleAutoMonitor(card);
    return updated;
  }

  // Card automático ao chegar no monitor: se há PR aberto, para no gate (o merge é sempre manual);
  // se pull_request foi pulado (sem PRs para mergear), conclui o card diretamente.
  private async settleAutoMonitor(card: PipelineCard): Promise<void> {
    // Há PR aberto: o merge na branch principal é SEMPRE manual (humano clica "Mergear PRs"),
    // mesmo em cards automáticos. O card fica no gate do monitor (já em awaiting_gate).
    if (card.repos.some((r) => r.prNumber)) return;
    const result = await execute("UPDATE pipeline_cards SET status = 'done' WHERE id = ? AND status <> 'done'", [card.id]);
    if (result.affectedRows > 0) {
      await this.emitCard(card.id);
      await this.removeCardWorktrees(card);
    }
  }

  private async retryOrFail(card: PipelineCard, field: RetryField, stage: PipelineStage, current: number, feedback: string): Promise<void> {
    if (current >= config.maxPipelineRetries) {
      await this.setCardStatus(card.id, "failed");
      return;
    }
    await execute(`UPDATE pipeline_cards SET ${field} = ${field} + 1, last_feedback = ?, status = 'idle' WHERE id = ?`, [feedback, card.id]);
    await this.emitCard(card.id);
    this.emit("stage:request", { cardId: card.id, stage });
  }

  private async routeBackToImplementation(card: PipelineCard, current: number, feedback: string): Promise<void> {
    if (current >= config.maxPipelineRetries) {
      await this.setCardStatus(card.id, "failed");
      return;
    }
    const status: CardStatus = card.auto ? "idle" : "awaiting_gate";
    await execute("UPDATE pipeline_cards SET e2e_retries = e2e_retries + 1, implementation_retries = 0, code_review_retries = 0, stage = 'implementation', last_feedback = ?, status = ? WHERE id = ?", [feedback, status, card.id]);
    await this.emitCard(card.id);
    if (card.auto) this.emit("stage:request", { cardId: card.id, stage: "implementation" as PipelineStage });
  }

  async onStageResult(cardId: string, runId: string): Promise<void> {
    const card = await this.getCard(cardId);
    if (!card) return;
    const run = await this.getRun(runId);
    if (!run || run.status === "error") {
      await this.setCardStatus(cardId, "failed");
      return;
    }
    const art = run.artifacts;
    switch (run.stage) {
      case "requirement":
        if (art.requirement) await this.advanceCard(card);
        else await this.setCardStatus(cardId, "failed");
        break;
      case "plan":
        if (art.plan) await this.advanceCard(card);
        else await this.setCardStatus(cardId, "failed");
        break;
      case "pull_request":
        if (art.prs && art.prs.length > 0) await this.advanceCard(card);
        else await this.setCardStatus(cardId, "failed");
        break;
      case "implementation": {
        if (art.tests?.passed === true) await this.advanceCard(card);
        else await this.retryOrFail(card, "implementation_retries", "implementation", card.implementationRetries, `Testes falharam:\n${art.tests?.logs ?? "(sem logs)"}`);
        break;
      }
      case "code_review": {
        if (art.review?.clean === true && art.review?.testsPass === true) await this.advanceCard(card);
        else await this.retryOrFail(card, "code_review_retries", "code_review", card.codeReviewRetries, `Code review não limpou:\n${art.review?.summary ?? "(sem resumo)"}`);
        break;
      }
      case "e2e": {
        if (art.e2e?.passed === true) await this.advanceCard(card);
        else {
          const shots = art.e2e?.screenshots?.length ? `\nEvidências: ${art.e2e.screenshots.join(", ")}` : "";
          await this.routeBackToImplementation(card, card.e2eRetries, `E2E falhou:\n${art.e2e?.logs ?? "(sem logs)"}${shots}`);
        }
        break;
      }
      // monitor não roda etapa (parkAtMonitorGate no runner) — sem case aqui.
    }
  }

  // ── PR monitoring (webhook-driven) ──

  async findCardRepoForPr(repoFullName: string, prNumber: number): Promise<{ card: PipelineCard; repo: PipelineCardRepo } | null> {
    const rows = await query<CardRepoRow[]>("SELECT * FROM pipeline_card_repos WHERE pr_number = ?", [prNumber]);
    // Casa exclusivamente pelo pr_url contendo o repo do webhook — nunca por número isolado
    // (pr_number é por-repo e pode colidir; um fallback "single row" casaria repo errado).
    const match = rows.find((r) => r.pr_url?.includes(`/${repoFullName}/pull/`));
    if (!match) {
      if (rows.length > 0) console.warn(`[pipeline] PR ${repoFullName}#${prNumber}: ${rows.length} repo(s) com esse nº, nenhum pr_url casou — webhook ignorado`);
      return null;
    }
    const card = await this.getCard(match.card_id);
    if (!card) return null;
    return { card, repo: mapCardRepo(match) };
  }

  async handlePrFeedback(repoFullName: string, prNumber: number, body: string, author: string): Promise<void> {
    if (config.pipelineBotLogin && author === config.pipelineBotLogin) return;
    const found = await this.findCardRepoForPr(repoFullName, prNumber);
    if (!found) return;
    const { card, repo } = found;
    if (card.status === "done" || card.stage !== "monitor") return;
    const feedback = `[Feedback do PR ${repo.repoName} #${prNumber} por @${author}]\n${body}`;
    if (card.lastFeedback === feedback) return; // ignora redelivery/comentário idêntico
    await execute(
      "UPDATE pipeline_cards SET stage = 'implementation', status = 'idle', implementation_retries = 0, code_review_retries = 0, last_feedback = ? WHERE id = ?",
      [feedback, card.id],
    );
    await this.emitCard(card.id);
    this.emit("stage:request", { cardId: card.id, stage: "implementation" as PipelineStage });
  }

  async handlePrClosed(repoFullName: string, prNumber: number, merged: boolean): Promise<void> {
    const found = await this.findCardRepoForPr(repoFullName, prNumber);
    if (!found) return;
    const { card, repo } = found;
    await execute("UPDATE pipeline_card_repos SET repo_status = ? WHERE id = ? AND repo_status NOT IN ('merged','closed')", [merged ? "merged" : "closed", repo.id]);
    await this.emitCard(card.id);
    if (card.status === "done") return;
    const repos = await this.getCardRepos(card.id);
    const allSettled = repos.every((r) => r.repoStatus === "merged" || r.repoStatus === "closed");
    const anyMerged = repos.some((r) => r.repoStatus === "merged");
    if (allSettled && card.stage === "monitor") {
      if (anyMerged) {
        // Conclusão idempotente: só um evento (re)entregue vence a corrida.
        const result = await execute("UPDATE pipeline_cards SET status = 'done' WHERE id = ? AND status <> 'done'", [card.id]);
        if (result.affectedRows > 0) {
          await this.emitCard(card.id);
          await this.removeCardWorktrees(card);
        }
      } else {
        // Todos os PRs fechados sem merge → trabalho rejeitado: falha para atenção humana (não fica preso).
        const result = await execute("UPDATE pipeline_cards SET status = 'failed', last_feedback = ? WHERE id = ? AND status NOT IN ('failed','done')", ["Todos os PRs foram fechados sem merge.", card.id]);
        if (result.affectedRows > 0) await this.emitCard(card.id);
      }
    }
  }

  async handlePrReopened(repoFullName: string, prNumber: number): Promise<void> {
    const found = await this.findCardRepoForPr(repoFullName, prNumber);
    if (!found || found.card.status === "done") return;
    await execute("UPDATE pipeline_card_repos SET repo_status = 'pr_open' WHERE id = ?", [found.repo.id]);
    await this.emitCard(found.card.id);
  }

  // Mergeia os PRs abertos do card via `gh pr merge` (operação determinística, sem agente).
  // Sucesso em todos → card concluído + worktrees limpas. Falha (conflito/checks) → registra o
  // erro em last_feedback e mantém o card no gate do monitor para atenção humana.
  async mergeCardPrs(cardId: string): Promise<{ merged: string[]; failed: { repo: string; error: string }[] }> {
    const card = await this.getCard(cardId);
    if (!card) return { merged: [], failed: [] };
    const pipeline = await this.getPipeline(card.pipelineId);
    const projectPath = pipeline ? safeProjectPath(pipeline.projectName) : null;

    const merged: string[] = [];
    const failed: { repo: string; error: string }[] = [];

    for (const repo of card.repos) {
      if (!repo.prNumber || repo.repoStatus === "merged" || repo.repoStatus === "closed") continue;
      const repoPath = projectPath ? resolveRepoPath(projectPath, repo.repoName) : null;
      if (!repoPath) { failed.push({ repo: repo.repoName, error: "repositório não resolvido" }); continue; }
      const res = await executeSpawn("gh", ["pr", "merge", String(repo.prNumber), "--merge"], repoPath, 120000)
        .catch((e) => ({ output: e instanceof Error ? e.message : String(e), exitCode: 1 }));
      if (res.exitCode === 0) {
        await execute("UPDATE pipeline_card_repos SET repo_status = 'merged' WHERE id = ?", [repo.id]);
        merged.push(repo.repoName);
      } else {
        failed.push({ repo: repo.repoName, error: res.output.slice(0, 400) });
      }
    }
    await this.emitCard(cardId);

    const repos = await this.getCardRepos(cardId);
    const allSettled = repos.every((r) => r.repoStatus === "merged" || r.repoStatus === "closed");
    if (failed.length === 0 && allSettled && repos.some((r) => r.repoStatus === "merged")) {
      const result = await execute("UPDATE pipeline_cards SET status = 'done' WHERE id = ? AND status <> 'done'", [cardId]);
      if (result.affectedRows > 0) {
        await this.emitCard(cardId);
        await this.removeCardWorktrees(card);
      }
    } else if (failed.length > 0) {
      const fb = `Falha ao mergear PR(s) — provável conflito com a base ou checks pendentes. Faça rebase/resolva (Devolver) ou tente novamente:\n${failed.map((f) => `- ${f.repo}: ${f.error}`).join("\n")}`;
      await execute("UPDATE pipeline_cards SET last_feedback = ? WHERE id = ?", [fb, cardId]);
      await this.emitCard(cardId);
    }
    return { merged, failed };
  }
}

export const pipelineManager = new PipelineManager();
