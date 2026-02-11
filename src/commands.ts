import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type Bot, type Context, InlineKeyboard, InputFile } from "grammy";
import {
  createAgentStructure,
  getAgentInfo,
  getAgentPaths,
  isValidAgentName,
  listAgentInfos,
  listAgents,
} from "./agents/manager.js";
import { broadcastMessage } from "./agents/messenger.js";
import { runCouncil } from "./agents/council.js";
import {
  createSchedule,
  listSchedules,
  listSchedulesByAgent,
  removeSchedule,
  removeSchedulesByAgent,
} from "./agents/scheduler.js";
import type { SessionMode } from "./agents/types.js";
import { config } from "./config.js";
import { type ExecutionInfo, executionManager } from "./execution-manager.js";
import { loadHistory } from "./history.js";
import { loadMetrics } from "./metrics.js";
import { processDelegation } from "./processor.js";
import { commandQueue } from "./queue.js";
import { cloneRepo, discoverRepos, removeRepo } from "./repositories.js";
import { tokenManager } from "./server/token-manager.js";
import { escapeHtml, formatStreamForTelegram } from "./telegram-format.js";
import { checkForUpdates, performUpdate, restartService } from "./updater.js";
import {
  clearAllSessionIds,
  getActiveAgent,
  getMode,
  getSession,
  getSessionId,
  getWorkingDirectory,
  isValidProjectName,
  isBusy,
  listProjects,
  resetSessionId,
  safeProjectPath,
  setActiveAgent,
  setActiveProject,
  setBusy,
  setMode,
} from "./session.js";

const HELP_TEXT = [
  "<b>📁 Projetos</b>",
  "/project — Selecionar projeto ativo",
  "/project add &lt;nome&gt; — Criar projeto (pasta)",
  "/project remove &lt;nome&gt; — Remover projeto",
  "/repository add &lt;url&gt; [nome] — Clonar repo no projeto ativo",
  "/repository list — Listar repos do projeto ativo",
  "/repository remove &lt;nome&gt; — Remover repo do projeto ativo",
  "",
  "<b>🤖 Agentes</b>",
  "/agent — Listar/criar/remover agentes",
  "/agent create &lt;nome&gt; — Criar agente",
  "/agent remove &lt;nome&gt; — Remover agente",
  "/agent info &lt;nome&gt; — Info detalhada",
  "/agent context &lt;nome&gt; add &lt;texto|url&gt; — Adicionar contexto",
  "/mode — Alternar entre projects/agents",
  "/delegate &lt;agente&gt; &lt;prompt&gt; — Execução one-shot",
  "/inbox [agente] — Mensagens pendentes",
  "/status — Dashboard de agentes",
  "/broadcast &lt;msg&gt; — Mensagem para todos",
  "/council &lt;tema&gt; — Reunião multi-agente",
  "/schedule &lt;agente&gt; &lt;instrução&gt; — Agendar tarefa",
  "/schedule list — Listar agendamentos",
  "/schedule remove &lt;id&gt; — Remover agendamento",
  "/metrics [agente] — Métricas de uso",
  "",
  "<b>⚙️ Geral</b>",
  "/current — Modo, projeto/agente e sessão",
  "/running — Execuções em andamento",
  "/stream &lt;id&gt; — Acompanhar saída em tempo real",
  "/stop_stream — Parar stream ativo",
  "/history [N] — Histórico de execuções",
  "/reset — Resetar sessão do contexto atual",
  "/clear — Resetar tudo",
  "/cancel — Cancelar execução",
  "/queue — Ver fila de comandos",
  "/queue_remove [id] — Remover item da fila",
  "/update — Verificar e aplicar atualizações",
  "/token — Token atual do dashboard",
  "/help — Lista de comandos",
].join("\n");

export function registerCommands(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("project", handleProject);
  bot.command("repository", handleRepository);
  bot.command("current", handleCurrent);
  bot.command("clear", handleClear);
  bot.command("reset", handleReset);
  bot.command("cancel", handleCancel);
  bot.command("running", handleRunning);
  bot.command("stream", handleStream);
  bot.command("stop_stream", handleStopStream);
  bot.command("history", handleHistory);
  bot.command("help", handleHelp);
  bot.command("token", handleToken);
  bot.command("agent", handleAgent);
  bot.command("mode", handleMode);
  bot.command("delegate", handleDelegate);
  bot.command("inbox", handleInbox);
  bot.command("status", handleStatus);
  bot.command("broadcast", handleBroadcast);
  bot.command("council", handleCouncil);
  bot.command("schedule", handleSchedule);
  bot.command("metrics", handleMetrics);
  bot.command("queue", handleQueue);
  bot.command("queue_remove", handleQueueRemove);
  bot.command("update", handleUpdate);
  bot.callbackQuery(/^select_project:/, handleSelectProject);
  bot.callbackQuery(/^queue_remove:/, handleQueueRemoveCallback);
  bot.callbackQuery(/^autoupdate:/, handleAutoUpdateCallback);
  bot.callbackQuery(/^select_agent:/, handleSelectAgent);
  bot.callbackQuery(/^stream_exec:/, handleStreamCallback);
  bot.callbackQuery(/^confirm_remove_project:/, handleConfirmRemoveProject);
}

async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(`Claudemar — Telegram interface for Claude CLI\n\n${HELP_TEXT}`, { parse_mode: "HTML" });
}

async function handleProject(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/project\s*/, "").trim();

  if (args) {
    const parts = args.split(/\s+/);
    const subcommand = parts[0];

    if (subcommand === "add" && parts[1]) {
      return handleProjectAdd(ctx, chatId, parts[1]);
    }

    if (subcommand === "remove" && parts[1]) {
      return handleProjectRemove(ctx, chatId, parts[1]);
    }

    await ctx.reply("Uso: /project [add <nome> | remove <nome>]");
    return;
  }

  const projects = listProjects();
  const keyboard = new InlineKeyboard();

  keyboard.text("Orchestrator (padrão)", "select_project:__orchestrator__");

  for (const project of projects) {
    keyboard.row().text(project, `select_project:${project}`);
  }

  if (projects.length === 0) {
    await ctx.reply(
      "Nenhum projeto encontrado. Use /project add <nome> para criar.\n\nUse Orchestrator como workspace padrão:",
      { reply_markup: keyboard },
    );
  } else {
    await ctx.reply("Selecione um projeto:", { reply_markup: keyboard });
  }
}

async function handleProjectAdd(ctx: Context, chatId: number, name: string): Promise<void> {
  if (!isValidProjectName(name)) {
    await ctx.reply("Nome de projeto inválido. Use apenas letras, números, '.', '-' e '_'.");
    return;
  }

  const projectPath = safeProjectPath(name);
  if (!projectPath) {
    await ctx.reply("Nome de projeto inválido.");
    return;
  }

  if (existsSync(projectPath)) {
    await ctx.reply(`Projeto "${name}" já existe.`);
    return;
  }

  try {
    mkdirSync(projectPath, { recursive: true });
    setActiveProject(chatId, name);
    setMode(chatId, "projects");
    await ctx.reply(`Projeto "${name}" criado e ativado.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Erro ao criar projeto: ${message}`);
  }
}

async function handleProjectRemove(ctx: Context, chatId: number, name: string): Promise<void> {
  const projectPath = safeProjectPath(name);
  if (!projectPath || !existsSync(projectPath)) {
    await ctx.reply(`Projeto "${name}" não encontrado.`);
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("Sim, remover", `confirm_remove_project:${name}`)
    .text("Cancelar", "confirm_remove_project:__cancel__");

  await ctx.reply(
    `Tem certeza que deseja remover o projeto "${name}" e todos os seus repositórios?`,
    { reply_markup: keyboard },
  );
}

async function handleConfirmRemoveProject(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const projectName = data.replace("confirm_remove_project:", "");

  if (projectName === "__cancel__") {
    await ctx.answerCallbackQuery({ text: "Remoção cancelada" });
    await ctx.editMessageText("Remoção cancelada.");
    return;
  }

  const projectPath = safeProjectPath(projectName);
  if (!projectPath || !existsSync(projectPath)) {
    await ctx.answerCallbackQuery({ text: "Projeto não encontrado" });
    return;
  }

  try {
    await rm(projectPath, { recursive: true, force: true });

    const session = getSession(chatId);
    if (session.activeProject === projectName) {
      setActiveProject(chatId, null);
    }

    await ctx.answerCallbackQuery({ text: "Projeto removido" });
    await ctx.editMessageText(`Projeto "${projectName}" removido.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.answerCallbackQuery({ text: "Erro ao remover" });
    await ctx.editMessageText(`Erro ao remover: ${message}`);
  }
}

async function handleSelectProject(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const projectName = data.replace("select_project:", "");

  if (projectName === "__orchestrator__") {
    setActiveProject(chatId, null);
    setMode(chatId, "projects");
    await ctx.answerCallbackQuery({ text: "Orchestrator selecionado" });
    await ctx.editMessageText(
      "Projeto ativo: Orchestrator (padrão)\nSessão resetada.",
    );
    return;
  }

  const projectPath = safeProjectPath(projectName);
  if (!projectPath || !existsSync(projectPath)) {
    await ctx.answerCallbackQuery({ text: "Projeto não encontrado" });
    return;
  }

  setActiveProject(chatId, projectName);
  setMode(chatId, "projects");
  await ctx.answerCallbackQuery({ text: `${projectName} selecionado` });
  await ctx.editMessageText(
    `Projeto ativo: ${projectName}\nSessão resetada.`,
  );
}

async function handleCurrent(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = getSession(chatId);
  const mode = getMode(chatId);
  const cwd = getWorkingDirectory(chatId);

  const lines: string[] = [`Modo: ${mode}`];

  if (mode === "agents") {
    lines.push(`Agente: ${session.activeAgent ?? "nenhum"}`);
  } else {
    lines.push(`Projeto: ${session.activeProject ?? "Orchestrator (padrão)"}`);
  }

  lines.push(`Sessão: ${getSessionId(chatId) ?? "nenhuma"}`);
  lines.push(`Dir: ${cwd}`);

  await ctx.reply(lines.join("\n"));
}

async function handleReset(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  resetSessionId(chatId);

  const mode = getMode(chatId);
  const session = getSession(chatId);
  const target = mode === "agents"
    ? session.activeAgent ?? "nenhum"
    : session.activeProject ?? "Orchestrator";

  await ctx.reply(`Sessão resetada para: ${target}`);
}

async function handleClear(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  setActiveProject(chatId, null);
  setActiveAgent(chatId, null);
  setMode(chatId, "projects");
  clearAllSessionIds(chatId);
  await ctx.reply("Resetado para Orchestrator. Todas as sessões limpas.");
}

async function handleCancel(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const activeExecs = executionManager.getActiveExecutions();
  const telegramExec = activeExecs.find((e) => e.source === "telegram");

  if (!telegramExec) {
    await ctx.reply("Nenhuma execução em andamento.");
    return;
  }

  executionManager.cancelExecution(telegramExec.id);
  setBusy(chatId, false);
  await ctx.reply("Execução cancelada.");
}

async function handleRepository(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/repository\s*/, "").trim();

  if (!args) {
    await ctx.reply("Uso: /repository add <url> [nome]\n/repository list\n/repository remove <nome>");
    return;
  }

  const session = getSession(chatId);
  if (!session.activeProject) {
    await ctx.reply("Nenhum projeto ativo. Use /project para selecionar ou /project add <nome> para criar.");
    return;
  }

  const projectPath = safeProjectPath(session.activeProject);
  if (!projectPath || !existsSync(projectPath)) {
    await ctx.reply("Projeto ativo não encontrado.");
    return;
  }

  const parts = args.split(/\s+/);
  const subcommand = parts[0];

  if (subcommand === "add") {
    const url = parts[1];
    if (!url) {
      await ctx.reply("Uso: /repository add <url> [nome]");
      return;
    }

    const statusMsg = await ctx.reply(`Clonando ${url}...`);

    try {
      const repoName = await cloneRepo(projectPath, url, parts[2]);
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Repositório clonado: ${repoName}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Erro ao clonar: ${message}`,
      );
    }
    return;
  }

  if (subcommand === "list") {
    try {
      const repos = await discoverRepos(projectPath);
      if (repos.length === 0) {
        await ctx.reply(`Nenhum repositório encontrado em "${session.activeProject}".`);
        return;
      }

      const lines = [`Repositórios em ${session.activeProject}:\n`];
      for (const repo of repos) {
        const dirty = repo.hasChanges ? " (modificado)" : "";
        lines.push(`- ${repo.name} [${repo.branch}]${dirty}`);
        if (repo.remoteUrl) lines.push(`  ${repo.remoteUrl}`);
      }
      await ctx.reply(lines.join("\n"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Erro: ${message}`);
    }
    return;
  }

  if (subcommand === "remove") {
    const repoName = parts[1];
    if (!repoName) {
      await ctx.reply("Uso: /repository remove <nome>");
      return;
    }

    try {
      await removeRepo(projectPath, repoName);
      await ctx.reply(`Repositório "${repoName}" removido.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Erro: ${message}`);
    }
    return;
  }

  await ctx.reply("Uso: /repository add <url> [nome]\n/repository list\n/repository remove <nome>");
}

async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    `Comandos disponíveis:\n\n${HELP_TEXT}\n\nEnvie qualquer texto para conversar com o Claude no projeto/agente ativo.`,
    { parse_mode: "HTML" },
  );
}

async function handleToken(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const token = tokenManager.getCurrentToken();
  await ctx.reply(token);
}

// --- Running ---

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function handleRunning(ctx: Context): Promise<void> {
  const activeExecs = executionManager.getActiveExecutions();

  if (activeExecs.length === 0) {
    await ctx.reply("Nenhuma execução em andamento.");
    return;
  }

  const now = Date.now();
  const lines = [`${activeExecs.length} execução(ões) em andamento:\n`];
  const keyboard = new InlineKeyboard();

  for (const exec of activeExecs) {
    const elapsedMs = now - exec.startedAt.getTime();
    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    const elapsed = minutes > 0 ? `há ${minutes}m ${seconds}s` : `há ${seconds}s`;
    const promptPreview = exec.prompt.length > 80
      ? exec.prompt.slice(0, 80) + "..."
      : exec.prompt;

    lines.push(`<code>${shortId(exec.id)}</code> [${exec.targetType}] ${exec.targetName}`);
    lines.push(`  ${promptPreview}`);
    lines.push(`  ${elapsed} · fonte: ${exec.source}`);
    lines.push("");

    keyboard.row().text(
      `📡 ${exec.targetName} (${shortId(exec.id)})`,
      `stream_exec:${shortId(exec.id)}`,
    );
  }

  await ctx.reply(lines.join("\n").trimEnd(), {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

// --- Stream ---

interface ActiveStream {
  execId: string;
  chatId: number;
  messageId: number;
  buffer: string;
  timer: ReturnType<typeof setInterval>;
  onOutput: (id: string, chunk: string) => void;
  onDone: (id: string, info: ExecutionInfo) => void;
}

const activeStreams = new Map<number, ActiveStream>();

const STREAM_INTERVAL_MS = 1500;
const STREAM_MAX_CHARS = 3500;

function stopStream(chatId: number): void {
  const stream = activeStreams.get(chatId);
  if (!stream) return;
  clearInterval(stream.timer);
  executionManager.off("output", stream.onOutput);
  executionManager.off("complete", stream.onDone);
  executionManager.off("error", stream.onDone);
  executionManager.off("cancel", stream.onDone);
  activeStreams.delete(chatId);
}

async function startStreamFromExec(chatId: number, botApi: Context["api"], exec: ExecutionInfo): Promise<void> {
  if (activeStreams.has(chatId)) {
    stopStream(chatId);
  }

  const currentOutput = exec.output ?? "";
  const initialText = currentOutput.length > STREAM_MAX_CHARS
    ? "..." + currentOutput.slice(-STREAM_MAX_CHARS)
    : currentOutput || "(aguardando output...)";

  const header = `📡 Stream: ${shortId(exec.id)} [${exec.targetName}]\n\n`;
  const msg = await botApi.sendMessage(chatId, formatStreamForTelegram(header + initialText), { parse_mode: "HTML" });

  let buffer = currentOutput;
  let dirty = false;

  const onOutput = (id: string, chunk: string) => {
    if (id !== exec.id) return;
    buffer += chunk;
    dirty = true;
  };

  const onDone = async (id: string, info: ExecutionInfo) => {
    if (id !== exec.id) return;
    stopStream(chatId);

    const statusLabel = info.status === "completed" ? "Concluída"
      : info.status === "error" ? "Erro"
      : "Cancelada";

    const footer = info.result
      ? `\n\n— ${statusLabel} · ${(info.result.durationMs / 1000).toFixed(1)}s · $${info.result.costUsd.toFixed(2)}`
      : `\n\n— ${statusLabel}${info.error ? `: ${info.error}` : ""}`;

    const finalText = buffer.length > STREAM_MAX_CHARS
      ? "..." + buffer.slice(-STREAM_MAX_CHARS)
      : buffer || "(sem output)";

    try {
      await botApi.editMessageText(chatId, msg.message_id, formatStreamForTelegram(header + finalText + footer), { parse_mode: "HTML" });
    } catch {
      // non-critical
    }
  };

  const timer = setInterval(async () => {
    if (!dirty) return;
    dirty = false;

    const display = buffer.length > STREAM_MAX_CHARS
      ? "..." + buffer.slice(-STREAM_MAX_CHARS)
      : buffer;

    try {
      await botApi.editMessageText(chatId, msg.message_id, formatStreamForTelegram(header + display), { parse_mode: "HTML" });
    } catch {
      // message not modified or rate limited
    }
  }, STREAM_INTERVAL_MS);

  executionManager.on("output", onOutput);
  executionManager.on("complete", onDone);
  executionManager.on("error", onDone);
  executionManager.on("cancel", onDone);

  activeStreams.set(chatId, {
    execId: exec.id,
    chatId,
    messageId: msg.message_id,
    buffer,
    timer,
    onOutput,
    onDone,
  });
}

async function handleStream(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/stream\s*/, "").trim();

  if (!arg) {
    await ctx.reply("Uso: /stream <id>\nUse /running para ver os IDs.");
    return;
  }

  const activeExecs = executionManager.getActiveExecutions();
  const exec = activeExecs.find((e) => e.id.startsWith(arg));

  if (!exec) {
    await ctx.reply("Execução não encontrada. Use /running para ver IDs ativos.");
    return;
  }

  await startStreamFromExec(chatId, ctx.api, exec);
}

async function handleStopStream(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  if (!activeStreams.has(chatId)) {
    await ctx.reply("Nenhum stream ativo.");
    return;
  }

  stopStream(chatId);
  await ctx.reply("Stream interrompido.");
}

async function handleStreamCallback(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const prefix = data.replace("stream_exec:", "");
  const activeExecs = executionManager.getActiveExecutions();
  const exec = activeExecs.find((e) => e.id.startsWith(prefix));

  if (!exec) {
    await ctx.answerCallbackQuery({ text: "Execução já finalizada." });
    return;
  }

  await ctx.answerCallbackQuery({ text: `Streaming ${shortId(exec.id)}...` });
  await startStreamFromExec(chatId, ctx.api, exec);
}

// --- History ---

async function handleHistory(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? "";
  const arg = text.replace(/^\/history\s*/, "").trim();
  let limit = 10;

  if (arg) {
    const parsed = Number.parseInt(arg, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 50);
    }
  }

  const entries = await loadHistory(limit);

  if (entries.length === 0) {
    await ctx.reply("Nenhum histórico de execuções.");
    return;
  }

  const statusEmoji: Record<string, string> = {
    completed: "✅",
    error: "❌",
    cancelled: "🛑",
  };

  const lines = [`Últimas ${entries.length} execuções:\n`];

  for (const entry of entries.reverse()) {
    const emoji = statusEmoji[entry.status] ?? "❔";
    const promptPreview = entry.prompt.length > 60
      ? entry.prompt.slice(0, 60) + "..."
      : entry.prompt;
    const durationSec = (entry.durationMs / 1000).toFixed(1);
    const cost = entry.costUsd > 0 ? `$${entry.costUsd.toFixed(2)}` : "-";
    lines.push(`${emoji} ${promptPreview}`);
    lines.push(`   ${durationSec}s · ${cost} — ${entry.targetName}`);
  }

  await ctx.reply(lines.join("\n"));
}

// --- Agent commands ---

async function handleAgent(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/agent\s*/, "").trim();

  if (!args) {
    return handleAgentList(ctx);
  }

  const parts = args.split(/\s+/);
  const subcommand = parts[0];

  if (subcommand === "create" && parts[1]) {
    return handleAgentCreate(ctx, parts[1]);
  }

  if (subcommand === "remove" && parts[1]) {
    return handleAgentRemove(ctx, chatId, parts[1]);
  }

  if (subcommand === "info" && parts[1]) {
    return handleAgentInfo(ctx, parts[1]);
  }

  if (subcommand === "context" && parts[1] && parts[2] === "add" && parts[3]) {
    const content = parts.slice(3).join(" ");
    return handleAgentContext(ctx, parts[1], content);
  }

  await ctx.reply("Uso: /agent [create|remove|info|context] <nome> ...");
}

async function handleAgentList(ctx: Context): Promise<void> {
  const agents = listAgents();
  const keyboard = new InlineKeyboard();

  for (const agent of agents) {
    keyboard.row().text(agent, `select_agent:${agent}`);
  }

  if (agents.length === 0) {
    await ctx.reply("Nenhum agente encontrado. Use /agent create <nome> para criar.");
  } else {
    await ctx.reply("Selecione um agente:", { reply_markup: keyboard });
  }
}

async function handleSelectAgent(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const agentName = data.replace("select_agent:", "");

  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.root)) {
    await ctx.answerCallbackQuery({ text: "Agente não encontrado" });
    return;
  }

  setActiveAgent(chatId, agentName);
  setMode(chatId, "agents");
  await ctx.answerCallbackQuery({ text: `${agentName} selecionado` });
  await ctx.editMessageText(
    `Agente ativo: ${agentName}\nModo: agents\nSessão resetada.`,
  );
}

async function handleAgentCreate(ctx: Context, name: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  if (!isValidAgentName(name)) {
    await ctx.reply("Nome inválido. Use apenas letras, números, '.', '-' e '_'.");
    return;
  }

  const paths = getAgentPaths(name);
  if (paths && existsSync(paths.root)) {
    await ctx.reply(`Agente "${name}" já existe.`);
    return;
  }

  const created = createAgentStructure(name);
  if (!created) {
    await ctx.reply("Erro ao criar agente.");
    return;
  }

  setActiveAgent(chatId, name);
  setMode(chatId, "agents");
  await ctx.reply(
    `Agente "${name}" criado.\nModo: agents\n\nEstrutura:\n- context/\n- inbox/\n- outbox/\n- output/\n\nCrie um CLAUDE.md na raiz do agente para definir a persona.`,
  );
}

async function handleAgentRemove(ctx: Context, chatId: number, name: string): Promise<void> {
  if (!isValidAgentName(name)) {
    await ctx.reply("Nome de agente inválido.");
    return;
  }

  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) {
    await ctx.reply(`Agente "${name}" não encontrado.`);
    return;
  }

  try {
    const removedSchedules = removeSchedulesByAgent(name);
    await rm(paths.root, { recursive: true, force: true });

    const session = getSession(chatId);
    if (session.activeAgent === name) {
      setActiveAgent(chatId, null);
      setMode(chatId, "projects");
    }

    let msg = `Agente "${name}" removido.`;
    if (removedSchedules > 0) {
      msg += ` ${removedSchedules} agendamento(s) removido(s).`;
    }
    await ctx.reply(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Erro ao remover: ${message}`);
  }
}

async function handleAgentInfo(ctx: Context, name: string): Promise<void> {
  const info = getAgentInfo(name);
  if (!info) {
    await ctx.reply(`Agente "${name}" não encontrado.`);
    return;
  }

  const paths = getAgentPaths(name)!;
  const lines: string[] = [`Agente: ${name}`];

  const claudeMdPath = resolve(paths.root, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf-8");
    const preview = content.split("\n").slice(0, 5).join("\n");
    lines.push(`\nCLAUDE.md (preview):\n${preview}`);
  } else {
    lines.push("\nCLAUDE.md: não encontrado");
  }

  try {
    const contextFiles = readdirSync(paths.context);
    lines.push(`\ncontext/: ${contextFiles.length} arquivo(s)`);
    for (const f of contextFiles.slice(0, 10)) {
      lines.push(`  - ${f}`);
    }
    if (contextFiles.length > 10) {
      lines.push(`  ... e mais ${contextFiles.length - 10}`);
    }
  } catch {
    lines.push("\ncontext/: vazio");
  }

  lines.push(`\nInbox: ${info.inboxCount} mensagem(ns)`);

  let outputCount = 0;
  try {
    outputCount = readdirSync(paths.output).length;
  } catch {
    // empty
  }
  lines.push(`Output: ${outputCount} arquivo(s)`);

  if (info.lastExecution) {
    lines.push(`Última execução: ${info.lastExecution.toISOString()}`);
  }

  const schedules = listSchedulesByAgent(name);
  if (schedules.length > 0) {
    lines.push(`\nAgendamentos: ${schedules.length}`);
    for (const s of schedules) {
      lines.push(`  - [${s.id}] ${s.cron} — ${s.cronHuman}`);
    }
  }

  await ctx.reply(lines.join("\n"));
}

async function handleAgentContext(ctx: Context, agentName: string, content: string): Promise<void> {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.root)) {
    await ctx.reply(`Agente "${agentName}" não encontrado.`);
    return;
  }

  mkdirSync(paths.context, { recursive: true });

  const isUrl = /^https?:\/\//.test(content);

  if (isUrl) {
    try {
      const response = await fetch(content);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const slug = content
        .replace(/^https?:\/\//, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .slice(0, 50);
      const filename = `${slug}.md`;
      writeFileSync(resolve(paths.context, filename), text, "utf-8");
      await ctx.reply(`Contexto adicionado: ${filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Erro ao buscar URL: ${message}`);
    }
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `nota-${timestamp}.md`;
    writeFileSync(resolve(paths.context, filename), content, "utf-8");
    await ctx.reply(`Contexto adicionado: ${filename}`);
  }
}

// --- Mode ---

async function handleMode(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const current = getMode(chatId);
  const next: SessionMode = current === "projects" ? "agents" : "projects";
  setMode(chatId, next);

  await ctx.reply(`Modo alterado: ${current} → ${next}\nSessão resetada.`);
}

// --- Delegate ---

async function handleDelegate(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/delegate\s*/, "").trim();

  const spaceIndex = args.indexOf(" ");
  if (!args || spaceIndex === -1) {
    await ctx.reply("Uso: /delegate <agente> <prompt>");
    return;
  }

  const agentName = args.slice(0, spaceIndex);
  const prompt = args.slice(spaceIndex + 1).trim();

  if (!isValidAgentName(agentName)) {
    await ctx.reply("Nome de agente inválido.");
    return;
  }

  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.root)) {
    await ctx.reply(`Agente "${agentName}" não encontrado.`);
    return;
  }

  if (executionManager.isTargetActive("agent", agentName)) {
    const item = commandQueue.enqueue({
      targetType: "agent",
      targetName: agentName,
      prompt,
      source: "telegram",
      cwd: paths.root,
      telegramChatId: chatId,
    });
    const preview = prompt.length > 60 ? prompt.slice(0, 60) + "..." : prompt;
    await ctx.reply(`[${agentName}] Adicionado a fila (#${item.seqId}). "${preview}"\nUse /queue para ver a fila.`);
    return;
  }

  setBusy(chatId, true);
  const statusMsg = await ctx.reply(`[${agentName}] Executando...`);

  await processDelegation(ctx, chatId, agentName, prompt, statusMsg);
}

// --- Inbox ---

async function handleInbox(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/inbox\s*/, "").trim();

  const agentName = args || getActiveAgent(chatId);
  if (!agentName) {
    await ctx.reply("Nenhum agente ativo. Use /inbox <agente> ou selecione um agente.");
    return;
  }

  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.inbox)) {
    await ctx.reply(`Agente "${agentName}" não encontrado.`);
    return;
  }

  let files: string[];
  try {
    files = readdirSync(paths.inbox).sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    await ctx.reply(`Inbox de ${agentName}: vazio.`);
    return;
  }

  const lines = [`Inbox de ${agentName}: ${files.length} mensagem(ns)\n`];
  for (const file of files) {
    lines.push(`- ${file}`);
  }

  const output = lines.join("\n");
  if (output.length > config.maxOutputLength) {
    const buffer = Buffer.from(output);
    await ctx.replyWithDocument(new InputFile(buffer, `inbox-${agentName}.txt`));
  } else {
    await ctx.reply(output);
  }
}

// --- Status ---

async function handleStatus(ctx: Context): Promise<void> {
  const infos = listAgentInfos();

  if (infos.length === 0) {
    await ctx.reply("Nenhum agente encontrado.");
    return;
  }

  const lines = ["Dashboard de agentes:\n"];
  for (const info of infos) {
    const lastExec = info.lastExecution
      ? info.lastExecution.toISOString().slice(0, 16).replace("T", " ")
      : "nunca";
    lines.push(`${info.name} — inbox: ${info.inboxCount} — última: ${lastExec}`);
  }

  await ctx.reply(lines.join("\n"));
}

// --- Broadcast ---

async function handleBroadcast(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? "";
  const content = text.replace(/^\/broadcast\s*/, "").trim();

  if (!content) {
    await ctx.reply("Uso: /broadcast <mensagem>");
    return;
  }

  const result = broadcastMessage(content);

  let msg = `Broadcast enviado para ${result.sent} agente(s).`;
  if (result.errors.length > 0) {
    msg += `\n\nErros:\n${result.errors.join("\n")}`;
  }

  await ctx.reply(msg);
}

// --- Council ---

async function handleCouncil(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const topic = text.replace(/^\/council\s*/, "").trim();

  if (!topic) {
    await ctx.reply("Uso: /council <tema>");
    return;
  }

  if (isBusy(chatId)) {
    await ctx.reply("Já existe uma execução em andamento. Aguarde ou use /cancel.");
    return;
  }

  setBusy(chatId, true);
  const statusMsg = await ctx.reply("Reunião de agentes em andamento...");

  try {
    const output = await runCouncil(topic, chatId);

    if (output.length > config.maxOutputLength) {
      const buffer = Buffer.from(output);
      const sizeKb = (buffer.byteLength / 1024).toFixed(1);
      await ctx.replyWithDocument(
        new InputFile(buffer, "council-result.txt"),
        { caption: `Resultado do council (${sizeKb} KB)` },
      );
    } else {
      await ctx.reply(output);
    }

    try {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, "Council finalizado.");
    } catch {
      // non-critical
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Erro no council: ${message}`,
      );
    } catch {
      // non-critical
    }
  } finally {
    setBusy(chatId, false);
  }
}

// --- Schedule ---

async function handleSchedule(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/schedule\s*/, "").trim();

  if (!args) {
    await ctx.reply("Uso: /schedule <agente> <instrução>\n/schedule list\n/schedule remove <id>");
    return;
  }

  if (args === "list") {
    return handleScheduleList(ctx);
  }

  const parts = args.split(/\s+/);
  if (parts[0] === "remove" && parts[1]) {
    return handleScheduleRemove(ctx, parts[1]);
  }

  const agentName = parts[0];
  const instruction = args.slice(agentName.length).trim();

  if (!instruction) {
    await ctx.reply("Uso: /schedule <agente> <instrução em linguagem natural>");
    return;
  }

  if (!isValidAgentName(agentName)) {
    await ctx.reply("Nome de agente inválido.");
    return;
  }

  if (isBusy(chatId)) {
    await ctx.reply("Já existe uma execução em andamento. Aguarde ou use /cancel.");
    return;
  }

  setBusy(chatId, true);
  const statusMsg = await ctx.reply("Criando agendamento...");

  try {
    const entry = await createSchedule(agentName, instruction, chatId);

    await ctx.reply(
      [
        "Agendamento criado:",
        `ID: ${entry.id}`,
        `Agente: ${entry.agent}`,
        `Cron: ${entry.cron}`,
        `Tarefa: ${entry.task}`,
        `Instrução original: ${entry.cronHuman}`,
        `Script: ${entry.scriptPath}`,
      ].join("\n"),
    );

    try {
      await ctx.api.editMessageText(chatId, statusMsg.message_id, "Agendamento criado.");
    } catch {
      // non-critical
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Erro ao criar agendamento: ${message}`,
      );
    } catch {
      // non-critical
    }
  } finally {
    setBusy(chatId, false);
  }
}

async function handleScheduleList(ctx: Context): Promise<void> {
  const schedules = listSchedules();

  if (schedules.length === 0) {
    await ctx.reply("Nenhum agendamento ativo.");
    return;
  }

  const lines = ["Agendamentos ativos:\n"];
  for (const s of schedules) {
    lines.push(`[${s.id}] ${s.agent} — ${s.cron} — ${s.cronHuman}`);
  }

  await ctx.reply(lines.join("\n"));
}

async function handleScheduleRemove(ctx: Context, id: string): Promise<void> {
  const removed = removeSchedule(id);

  if (removed) {
    await ctx.reply(`Agendamento ${id} removido.`);
  } else {
    await ctx.reply(`Agendamento ${id} não encontrado.`);
  }
}

// --- Metrics ---

async function handleMetrics(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? "";
  const agentName = text.replace(/^\/metrics\s*/, "").trim();

  const metrics = loadMetrics();

  if (agentName) {
    const m = metrics[agentName];
    if (!m) {
      await ctx.reply(`Nenhuma métrica para "${agentName}".`);
      return;
    }

    const avgDuration = m.executions > 0
      ? (m.totalDurationMs / m.executions / 1000).toFixed(1)
      : "0";

    await ctx.reply(
      [
        `Métricas: ${agentName}`,
        `Execuções: ${m.executions}`,
        `Custo total: $${m.totalCostUsd.toFixed(2)}`,
        `Duração média: ${avgDuration}s`,
      ].join("\n"),
    );
    return;
  }

  const agents = Object.keys(metrics);
  if (agents.length === 0) {
    await ctx.reply("Nenhuma métrica registrada.");
    return;
  }

  const lines = ["Métricas de uso:\n"];
  for (const agent of agents) {
    const m = metrics[agent];
    const avgDuration = m.executions > 0
      ? (m.totalDurationMs / m.executions / 1000).toFixed(1)
      : "0";
    lines.push(
      `${agent} — ${m.executions} exec · $${m.totalCostUsd.toFixed(2)} · avg ${avgDuration}s`,
    );
  }

  await ctx.reply(lines.join("\n"));
}

// --- Queue ---

async function handleQueue(ctx: Context): Promise<void> {
  const grouped = commandQueue.getGrouped();

  if (grouped.size === 0) {
    await ctx.reply("Fila vazia.");
    return;
  }

  const lines: string[] = ["<b>Fila de comandos:</b>\n"];

  for (const [key, items] of grouped) {
    const [type, ...nameParts] = key.split(":");
    const name = nameParts.join(":");
    lines.push(`<b>[${type}] ${name}:</b>`);
    for (const item of items) {
      const preview = item.prompt.length > 60
        ? item.prompt.slice(0, 60) + "..."
        : item.prompt;
      lines.push(`  #${item.seqId} — "${preview}"`);
    }
    lines.push("");
  }

  await ctx.reply(lines.join("\n").trimEnd(), { parse_mode: "HTML" });
}

async function handleQueueRemove(ctx: Context): Promise<void> {
  const text = ctx.message?.text ?? "";
  const args = text.replace(/^\/queue_remove\s*/, "").trim();

  if (args) {
    const seqId = parseInt(args, 10);
    if (Number.isNaN(seqId)) {
      await ctx.reply("Uso: /queue_remove <id>");
      return;
    }

    const removed = commandQueue.remove(seqId);
    if (removed) {
      await ctx.reply(`Item #${seqId} removido da fila.`);
    } else {
      await ctx.reply(`Item #${seqId} não encontrado na fila.`);
    }
    return;
  }

  const all = commandQueue.getAll();
  if (all.length === 0) {
    await ctx.reply("Fila vazia.");
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const item of all) {
    const preview = item.prompt.length > 30
      ? item.prompt.slice(0, 30) + "..."
      : item.prompt;
    keyboard.row().text(
      `#${item.seqId} [${item.targetName}] ${preview}`,
      `queue_remove:${item.seqId}`,
    );
  }

  await ctx.reply("Selecione o item para remover:", { reply_markup: keyboard });
}

async function handleQueueRemoveCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const seqId = parseInt(data.replace("queue_remove:", ""), 10);
  if (Number.isNaN(seqId)) return;

  const removed = commandQueue.remove(seqId);
  if (removed) {
    await ctx.answerCallbackQuery({ text: `Item #${seqId} removido.` });
    try {
      await ctx.editMessageText(`Item #${seqId} removido da fila.`);
    } catch { /* non-critical */ }
  } else {
    await ctx.answerCallbackQuery({ text: `Item #${seqId} não encontrado.` });
  }
}

// --- Update ---

async function handleUpdate(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const statusMsg = await ctx.reply("Verificando atualizações...");

  try {
    const info = await checkForUpdates();

    if (!info.available) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Versão atual: <code>${info.currentCommit}</code> (${info.currentDate.split(" ")[0]})\n\nNenhuma atualização disponível.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const commitLines = info.commits
      .map((c) => {
        const hash = c.split(" ")[0];
        const msg = escapeHtml(c.slice(hash.length + 1));
        return `• <code>${hash}</code> ${msg}`;
      })
      .join("\n");

    const text = [
      `Versão atual: <code>${info.currentCommit}</code> (${info.currentDate.split(" ")[0]})`,
      "",
      `<b>${info.commitCount}</b> commit(s) novo(s):`,
      commitLines,
      "",
      `Nova versão: <code>${info.remoteCommit}</code>`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("Atualizar agora", "autoupdate:confirm")
      .text("Ignorar", "autoupdate:dismiss");

    await ctx.api.editMessageText(chatId, statusMsg.message_id, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `Erro ao verificar atualizações: ${message}`,
    );
  }
}

async function handleAutoUpdateCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const action = data.replace("autoupdate:", "");

  if (action === "dismiss") {
    await ctx.answerCallbackQuery({ text: "Atualização ignorada." });
    try {
      await ctx.editMessageText("Atualização ignorada.");
    } catch { /* non-critical */ }
    return;
  }

  if (action !== "confirm") return;

  await ctx.answerCallbackQuery({ text: "Iniciando atualização..." });
  try {
    await ctx.editMessageText("Atualizando... (isso pode levar alguns minutos)");
  } catch { /* non-critical */ }

  try {
    const result = await performUpdate();

    if (result.success) {
      await ctx.api.sendMessage(chatId, "Atualização concluída! Reiniciando serviço...");
      setTimeout(() => restartService(), 1000);
    } else {
      await ctx.api.sendMessage(
        chatId,
        `Falha na atualização:\n<pre>${escapeHtml(result.output)}</pre>`,
        { parse_mode: "HTML" },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.api.sendMessage(chatId, `Erro na atualização: ${message}`);
  }
}
