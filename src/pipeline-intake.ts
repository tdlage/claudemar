import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { RowDataPacket } from "mysql2/promise";
import { pipelineManager, type Pipeline, type PipelineIntakePlugin } from "./pipeline-manager.js";
import { executionManager } from "./execution-manager.js";
import { createPipelineMcpServer } from "./pipeline-mcp.js";
import { safeProjectPath } from "./session.js";
import { query, getPool } from "./database.js";
import { config } from "./config.js";
import { resolveTimeoutMs } from "./pipeline-timeout.js";
import type { IntakePluginType } from "./pipeline-migration.js";

type IntakeExecutor = (plugin: PipelineIntakePlugin, pipeline: Pipeline) => Promise<number>;

interface AgentIntakeConfig {
  prompt?: string;
  skill?: string;
  source?: string;
  timeoutMs?: number;
}

async function countCards(pipelineId: string): Promise<number> {
  const rows = await query<RowDataPacket[]>("SELECT COUNT(*) AS c FROM pipeline_cards WHERE pipeline_id = ?", [pipelineId]);
  return Number(rows[0]?.c ?? 0);
}

async function fetchUsageContext(projectName: string): Promise<string> {
  const rows = await query<(RowDataPacket & { prompt: string; status: string; error: string | null })[]>(
    "SELECT prompt, status, error FROM execution_history WHERE target_type = 'project' AND target_name = ? ORDER BY started_at DESC LIMIT 50",
    [projectName],
  );
  if (rows.length === 0) return "";
  const lines = rows.map((r) => `- [${r.status}] ${String(r.prompt).slice(0, 200)}${r.error ? ` (erro: ${String(r.error).slice(0, 120)})` : ""}`);
  return `## Histórico recente de execuções do projeto (use para detectar padrões de uso e problemas recorrentes)\n${lines.join("\n")}`;
}

function waitForExecution(execId: string): Promise<void> {
  return new Promise((resolve) => {
    const done = (eid: string) => {
      if (eid !== execId) return;
      executionManager.off("complete", done);
      executionManager.off("error", done);
      executionManager.off("cancel", done);
      resolve();
    };
    executionManager.on("complete", done);
    executionManager.on("error", done);
    executionManager.on("cancel", done);
  });
}

// Serializa execuções de intake por agente ENTRE PROCESSOS (vários cron disparando no mesmo
// minuto rodam em processos headless distintos) via lock nomeado do MySQL, evitando uma rajada
// de execuções Opus simultâneas. Intake é ocasional, então serializar (1 por vez) é seguro.
async function withIntakeLock<T>(fn: () => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    // timeout 0 = try-lock não-bloqueante: não segura a conexão do pool esperando.
    const [rows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('pipeline_intake_global', 0) AS ok");
    if (rows[0]?.ok !== 1) throw new Error("Outro intake já está em execução; tente novamente mais tarde");
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK('pipeline_intake_global')").catch(() => {});
    }
  } finally {
    conn.release();
  }
}

const runAgentIntake: IntakeExecutor = async (plugin, pipeline) => {
  const projectPath = safeProjectPath(pipeline.projectName);
  if (!projectPath || !existsSync(projectPath)) throw new Error("Projeto não encontrado");

  const cfg = plugin.config as AgentIntakeConfig;
  const userPrompt = (cfg.prompt || "").trim();
  if (!userPrompt) throw new Error("Plugin 'agent' requer um prompt em config.prompt");

  const usage = cfg.source === "execution_history" ? await fetchUsageContext(pipeline.projectName) : "";

  return withIntakeLock(async () => {
    const before = await countCards(pipeline.id);
    const runId = randomUUID();
    const mcp = createPipelineMcpServer({ runId, cardId: null, pipelineId: pipeline.id, stage: "intake" });

    const prompt = [
      userPrompt,
      usage,
      "Antes de propor, consulte mcp__memory__search_memory por features já feitas ou em andamento neste projeto para não duplicar.",
      "Ao final, chame mcp__pipeline__propose_items com os itens de trabalho identificados (title + input por item). Se nada relevante for encontrado, chame com uma lista vazia.",
    ].filter(Boolean).join("\n\n");

    const execId = executionManager.startExecution({
      source: "pipeline",
      targetType: "project",
      targetName: pipeline.projectName,
      prompt,
      cwd: projectPath,
      autoApprove: true,
      noResume: true,
      username: `pipeline-intake:${plugin.id}:${runId}`,
      skills: cfg.skill ? [cfg.skill] : undefined,
      extraMcpServers: { pipeline: mcp },
      timeoutMs: resolveTimeoutMs(cfg.timeoutMs ?? null, config.pipelineStageTimeoutMs),
    });

    try {
      await waitForExecution(execId);
    } finally {
      executionManager.clearSessionId("project", pipeline.projectName, `pipeline-intake:${plugin.id}:${runId}`);
    }

    return Math.max(0, (await countCards(pipeline.id)) - before);
  });
};

// Registry plugável. v1: 'manual' (cards pela UI) e 'agent' (fonte custom). github_issues/usage_pattern
// dedicados ficam como extensões futuras registrando seu executor aqui.
const REGISTRY: Partial<Record<IntakePluginType, IntakeExecutor>> = {
  manual: async () => 0,
  agent: runAgentIntake,
};

// Evita rodar o MESMO plugin em paralelo (ex.: "Rodar agora" clicado 2x, ou cron sobreposto no
// mesmo processo). Concorrência global entre processos cron distintos é limitada pelo espaçamento
// do agendamento — cada cron roda em um processo headless próprio.
const runningIntakes = new Set<string>();

export async function runIntake(pluginId: string): Promise<number> {
  const plugin = await pipelineManager.getIntakePlugin(pluginId);
  if (!plugin) throw new Error("Plugin de intake não encontrado");
  if (!plugin.enabled) throw new Error("Plugin de intake desabilitado");

  const pipeline = await pipelineManager.getPipeline(plugin.pipelineId);
  if (!pipeline) throw new Error("Pipeline não encontrada");

  const executor = REGISTRY[plugin.type];
  if (!executor) throw new Error(`Origem de intake '${plugin.type}' ainda não habilitada`);

  if (runningIntakes.has(pluginId)) throw new Error("Intake deste plugin já está em execução");
  runningIntakes.add(pluginId);
  try {
    return await executor(plugin, pipeline);
  } finally {
    runningIntakes.delete(pluginId);
  }
}
