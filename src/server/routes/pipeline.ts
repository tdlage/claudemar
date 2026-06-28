import { existsSync } from "node:fs";
import { Router } from "express";
import { pipelineManager } from "../../pipeline-manager.js";
import { signPipelineScreenshots } from "../../pipeline-runner.js";
import { runIntake } from "../../pipeline-intake.js";
import { safeProjectPath } from "../../session.js";
import { discoverRepos } from "../../repositories.js";
import { isValidCron } from "../../pipeline-cron.js";
import { PIPELINE_STAGES, type PipelineStage } from "../../pipeline-migration.js";

export const pipelineRouter = Router();

const STAGE_KEYS = new Set<string>(["intake", ...PIPELINE_STAGES.map((s) => s.key)]);

function authorId(req: Express.Request): string {
  const ctx = req.ctx!;
  return ctx.role === "admin" ? "admin" : ctx.userId;
}

async function projectRepoNames(projectName: string): Promise<string[]> {
  const projectPath = safeProjectPath(projectName);
  if (!projectPath || !existsSync(projectPath)) return [];
  const repos = await discoverRepos(projectPath);
  return repos.map((r) => r.name);
}

// ── Pipeline (per project) ──

pipelineRouter.get("/projects/:project", async (req, res) => {
  const projectName = req.params.project as string;
  const projectPath = safeProjectPath(projectName);
  if (!projectPath || !existsSync(projectPath)) { res.status(404).json({ error: "Project not found" }); return; }

  const pipeline = await pipelineManager.getPipelineByProject(projectName);
  const repos = await projectRepoNames(projectName);
  if (!pipeline) { res.json({ pipeline: null, stageConfigs: [], plugins: [], repos }); return; }

  const [stageConfigs, plugins] = await Promise.all([
    pipelineManager.getStageConfigs(pipeline.id),
    pipelineManager.listIntakePlugins(pipeline.id),
  ]);
  res.json({ pipeline, stageConfigs, plugins, repos });
});

pipelineRouter.post("/projects/:project", async (req, res) => {
  const projectName = req.params.project as string;
  const projectPath = safeProjectPath(projectName);
  if (!projectPath || !existsSync(projectPath)) { res.status(404).json({ error: "Project not found" }); return; }

  const existing = await pipelineManager.getPipelineByProject(projectName);
  if (existing) { res.status(409).json({ error: "Pipeline already exists" }); return; }

  const repos = await projectRepoNames(projectName);
  if (repos.length === 0) { res.status(400).json({ error: "Projeto não possui repositórios git" }); return; }

  const pipeline = await pipelineManager.createPipeline({
    projectName,
    defaultBaseBranch: typeof req.body.defaultBaseBranch === "string" ? req.body.defaultBaseBranch : undefined,
    createdBy: authorId(req),
  });
  const stageConfigs = await pipelineManager.getStageConfigs(pipeline.id);
  res.status(201).json({ pipeline, stageConfigs, plugins: [], repos });
});

pipelineRouter.put("/:pipelineId", async (req, res) => {
  const pipeline = await pipelineManager.updatePipeline(req.params.pipelineId as string, {
    defaultBaseBranch: req.body.defaultBaseBranch,
    defaultAuto: req.body.defaultAuto,
  });
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }
  res.json(pipeline);
});

pipelineRouter.put("/:pipelineId/stages/:stage", async (req, res) => {
  const stage = req.params.stage as string;
  if (!STAGE_KEYS.has(stage)) { res.status(400).json({ error: "Invalid stage" }); return; }
  const cfg = await pipelineManager.updateStageConfig(req.params.pipelineId as string, stage as PipelineStage, {
    promptTemplate: req.body.promptTemplate,
    skill: req.body.skill,
    agentName: req.body.agentName,
    timeoutMs: req.body.timeoutMs,
  });
  if (!cfg) { res.status(404).json({ error: "Stage config not found" }); return; }
  res.json(cfg);
});

// ── Cards ──

pipelineRouter.get("/:pipelineId/cards", async (req, res) => {
  const cards = await pipelineManager.getCardsByPipeline(req.params.pipelineId as string);
  res.json(cards);
});

pipelineRouter.post("/:pipelineId/cards", async (req, res) => {
  const { title, intakeInput, auto, repos, baseBranch } = req.body;
  if (!title || typeof title !== "string") { res.status(400).json({ error: "title required" }); return; }
  try {
    const card = await pipelineManager.createCard({
      pipelineId: req.params.pipelineId as string,
      title,
      intakeInput: typeof intakeInput === "string" ? intakeInput : "",
      auto: auto === true,
      repos: Array.isArray(repos) ? repos.filter((r: unknown): r is string => typeof r === "string") : undefined,
      baseBranch: typeof baseBranch === "string" ? baseBranch : undefined,
      originType: "manual",
      createdBy: authorId(req),
    });
    res.status(201).json(card);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create card" });
  }
});

pipelineRouter.get("/cards/:id", async (req, res) => {
  const card = await pipelineManager.getCard(req.params.id as string);
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  const runs = await pipelineManager.getRunsByCard(card.id);
  res.json({ card, runs: runs.map((r) => ({ ...r, artifacts: signPipelineScreenshots(r.artifacts) })) });
});

pipelineRouter.put("/cards/:id", async (req, res) => {
  const card = await pipelineManager.updateCard(req.params.id as string, {
    title: req.body.title,
    requirementText: req.body.requirementText,
    planMarkdown: req.body.planMarkdown,
    intakeInput: req.body.intakeInput,
  });
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  res.json(card);
});

pipelineRouter.delete("/cards/:id", async (req, res) => {
  const id = req.params.id as string;
  const card = await pipelineManager.getCard(id);
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  if (card.status === "running") { res.status(409).json({ error: "Não é possível excluir um card em execução" }); return; }
  const deleted = await pipelineManager.deleteCard(id);
  if (!deleted) { res.status(404).json({ error: "Card not found" }); return; }
  res.json({ deleted: true });
});

pipelineRouter.put("/cards/:id/repos", async (req, res) => {
  const repos = Array.isArray(req.body.repos) ? req.body.repos.filter((r: unknown): r is string => typeof r === "string") : [];
  if (repos.length === 0) { res.status(400).json({ error: "ao menos 1 repositório" }); return; }
  const card = await pipelineManager.setCardRepos(req.params.id as string, repos);
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  res.json(card);
});

pipelineRouter.patch("/cards/:id/auto", async (req, res) => {
  const card = await pipelineManager.setAuto(req.params.id as string, req.body.auto === true);
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  res.json(card);
});

pipelineRouter.patch("/cards/:id/skip", async (req, res) => {
  try {
    const card = await pipelineManager.setSkippedStages(req.params.id as string, req.body.skippedStages);
    if (!card) { res.status(404).json({ error: "Card not found" }); return; }
    res.json(card);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Etapas inválidas" });
  }
});

pipelineRouter.post("/cards/:id/advance", async (req, res) => {
  const ok = await pipelineManager.approveGate(req.params.id as string);
  if (!ok) { res.status(409).json({ error: "Card não está aguardando aprovação" }); return; }
  res.json({ ok: true });
});

pipelineRouter.post("/cards/:id/reject", async (req, res) => {
  const ok = await pipelineManager.rejectGate(req.params.id as string);
  if (!ok) { res.status(404).json({ error: "Card not found" }); return; }
  res.json({ ok: true });
});

pipelineRouter.post("/cards/:id/send-back", async (req, res) => {
  const feedback = typeof req.body.feedback === "string" ? req.body.feedback : "";
  const ok = await pipelineManager.sendBack(req.params.id as string, feedback);
  if (!ok) { res.status(404).json({ error: "Card not found" }); return; }
  res.json({ ok: true });
});

pipelineRouter.post("/cards/:id/retry", async (req, res) => {
  const ok = await pipelineManager.retry(req.params.id as string);
  if (!ok) { res.status(409).json({ error: "Card em execução ou inexistente" }); return; }
  res.json({ ok: true });
});

pipelineRouter.post("/cards/:id/merge", async (req, res) => {
  const result = await pipelineManager.mergeCardPrs(req.params.id as string);
  res.json(result);
});

pipelineRouter.get("/cards/:id/runs", async (req, res) => {
  const card = await pipelineManager.getCard(req.params.id as string);
  if (!card) { res.status(404).json({ error: "Card not found" }); return; }
  const runs = await pipelineManager.getRunsByCard(card.id);
  res.json(runs.map((r) => ({ ...r, artifacts: signPipelineScreenshots(r.artifacts) })));
});

// ── Intake plugins ──

pipelineRouter.get("/:pipelineId/plugins", async (req, res) => {
  const plugins = await pipelineManager.listIntakePlugins(req.params.pipelineId as string);
  res.json(plugins);
});

pipelineRouter.post("/:pipelineId/plugins", async (req, res) => {
  const { type, name, config, enabled, cron } = req.body;
  if (!type || !name) { res.status(400).json({ error: "type and name required" }); return; }
  if (typeof cron === "string" && cron.trim() && !isValidCron(cron)) { res.status(400).json({ error: "Expressão cron inválida (5 campos: min hora dia mês dia-da-semana)" }); return; }
  const plugin = await pipelineManager.createIntakePlugin({
    pipelineId: req.params.pipelineId as string,
    type,
    name,
    config: typeof config === "object" && config ? config : {},
    enabled: enabled !== false,
    cron: typeof cron === "string" ? cron : null,
  });
  res.status(201).json(plugin);
});

pipelineRouter.put("/plugins/:id", async (req, res) => {
  if (typeof req.body.cron === "string" && req.body.cron.trim() && !isValidCron(req.body.cron)) { res.status(400).json({ error: "Expressão cron inválida (5 campos)" }); return; }
  const plugin = await pipelineManager.updateIntakePlugin(req.params.id as string, {
    name: req.body.name,
    config: req.body.config,
    enabled: req.body.enabled,
    cron: req.body.cron,
  });
  if (!plugin) { res.status(404).json({ error: "Plugin not found" }); return; }
  res.json(plugin);
});

pipelineRouter.delete("/plugins/:id", async (req, res) => {
  const deleted = await pipelineManager.deleteIntakePlugin(req.params.id as string);
  if (!deleted) { res.status(404).json({ error: "Plugin not found" }); return; }
  res.json({ deleted: true });
});

pipelineRouter.post("/plugins/:id/run", async (req, res) => {
  const id = req.params.id as string;
  const plugin = await pipelineManager.getIntakePlugin(id);
  if (!plugin) { res.status(404).json({ error: "Plugin not found" }); return; }
  if (!plugin.enabled) { res.status(400).json({ error: "Plugin desabilitado" }); return; }
  if (plugin.type === "agent") {
    const cfg = plugin.config as { prompt?: string };
    if (!cfg.prompt || !cfg.prompt.trim()) { res.status(400).json({ error: "Plugin 'agent' requer um prompt configurado" }); return; }
  }
  // O intake por agente é demorado: dispara em background; os cards aparecem via socket.
  runIntake(id).catch((err) => console.error(`[pipeline] intake run failed for ${id}:`, err));
  res.status(202).json({ started: true });
});
