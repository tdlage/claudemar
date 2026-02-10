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
import { executionManager } from "./execution-manager.js";
import { executeShell, executeSpawn } from "./executor.js";
import { loadHistory } from "./history.js";
import { loadMetrics } from "./metrics.js";
import { processDelegation } from "./processor.js";
import { tokenManager } from "./server/token-manager.js";
import {
  getActiveAgent,
  getMode,
  getSession,
  getWorkingDirectory,
  isValidProjectName,
  isBusy,
  listProjects,
  safeProjectPath,
  setActiveAgent,
  setActiveProject,
  setBusy,
  setMode,
} from "./session.js";

const HELP_TEXT = [
  "<b>📁 Projetos</b>",
  "/project — Selecionar projeto ativo",
  "/add &lt;url&gt; [nome] — Clonar repositório",
  "/remove &lt;projeto&gt; — Remover projeto",
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
  "/history [N] — Histórico de execuções",
  "/clear — Resetar tudo",
  "/cancel — Cancelar execução",
  "/exec &lt;cmd&gt; — Executar comando shell",
  "/git &lt;subcmd&gt; — Executar comando git",
  "/token — Token atual do dashboard",
  "/help — Lista de comandos",
].join("\n");

export function registerCommands(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("project", handleProject);
  bot.command("current", handleCurrent);
  bot.command("clear", handleClear);
  bot.command("cancel", handleCancel);
  bot.command("running", handleRunning);
  bot.command("history", handleHistory);
  bot.command("exec", handleExec);
  bot.command("git", handleGit);
  bot.command("add", handleAdd);
  bot.command("remove", handleRemove);
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
  bot.callbackQuery(/^select_project:/, handleSelectProject);
  bot.callbackQuery(/^select_agent:/, handleSelectAgent);
}

async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(`Claudemar — Telegram interface for Claude CLI\n\n${HELP_TEXT}`, { parse_mode: "HTML" });
}

async function handleProject(ctx: Context): Promise<void> {
  const projects = listProjects();
  const keyboard = new InlineKeyboard();

  keyboard.text("Orchestrator (padrão)", "select_project:__orchestrator__");

  for (const project of projects) {
    keyboard.row().text(project, `select_project:${project}`);
  }

  if (projects.length === 0) {
    await ctx.reply(
      "Nenhum projeto encontrado. Use /add <url> para clonar um repositório.\n\nUse Orchestrator como workspace padrão:",
      { reply_markup: keyboard },
    );
  } else {
    await ctx.reply("Selecione um projeto:", { reply_markup: keyboard });
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

  lines.push(`Sessão: ${session.sessionId ?? "nenhuma"}`);
  lines.push(`Dir: ${cwd}`);

  await ctx.reply(lines.join("\n"));
}

async function handleClear(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  setActiveProject(chatId, null);
  setActiveAgent(chatId, null);
  setMode(chatId, "projects");
  await ctx.reply("Resetado para Orchestrator. Sessão limpa.");
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

async function replyWithShellOutput(
  ctx: Context,
  output: string,
  exitCode: number,
  filename: string,
): Promise<void> {
  const response = output || "(sem output)";
  const footer = exitCode === 0 ? "exit: 0" : `exit: ${exitCode}`;

  if (response.length > config.maxOutputLength) {
    const buffer = Buffer.from(response);
    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption: footer,
    });
  } else {
    await ctx.reply(`${response}\n\n${footer}`);
  }
}

async function handleExec(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const command = text.replace(/^\/exec\s*/, "").trim();

  if (!command) {
    await ctx.reply("Uso: /exec <comando>");
    return;
  }

  const cwd = getWorkingDirectory(chatId);

  try {
    const { output, exitCode } = await executeShell(command, cwd);
    await replyWithShellOutput(ctx, output, exitCode, "output.txt");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Erro: ${message}`);
  }
}

async function handleGit(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const subcmd = text.replace(/^\/git\s*/, "").trim();

  if (!subcmd) {
    await ctx.reply("Uso: /git <subcomando>");
    return;
  }

  const cwd = getWorkingDirectory(chatId);

  try {
    const args = subcmd.split(/\s+/);
    const { output, exitCode } = await executeSpawn("git", args, cwd);
    await replyWithShellOutput(ctx, output, exitCode, "git-output.txt");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Erro: ${message}`);
  }
}

async function handleAdd(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const parts = text.replace(/^\/add\s*/, "").trim().split(/\s+/);
  const url = parts[0];

  if (!url) {
    await ctx.reply("Uso: /add <url> [nome]");
    return;
  }

  const repoName =
    parts[1] ?? url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";

  if (!isValidProjectName(repoName)) {
    await ctx.reply("Nome de projeto inválido. Use apenas letras, números, '.', '-' e '_'.");
    return;
  }

  const targetPath = safeProjectPath(repoName);
  if (!targetPath) {
    await ctx.reply("Nome de projeto inválido.");
    return;
  }

  if (existsSync(targetPath)) {
    await ctx.reply(`Projeto "${repoName}" já existe.`);
    return;
  }

  const statusMsg = await ctx.reply(`Clonando ${url}...`);

  try {
    const { output, exitCode } = await executeSpawn(
      "git",
      ["clone", url, targetPath],
      config.projectsPath,
      120000,
    );

    if (exitCode !== 0) {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `Erro ao clonar: ${output}`,
      );
      return;
    }

    setActiveProject(chatId, repoName);
    setMode(chatId, "projects");
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `Repositório clonado e ativado: ${repoName}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `Erro ao clonar: ${message}`,
    );
  }
}

async function handleRemove(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = ctx.message?.text ?? "";
  const projectName = text.replace(/^\/remove\s*/, "").trim();

  if (!projectName) {
    await ctx.reply("Uso: /remove <projeto>");
    return;
  }

  const projectPath = safeProjectPath(projectName);
  if (!projectPath) {
    await ctx.reply("Nome de projeto inválido.");
    return;
  }

  if (!existsSync(projectPath)) {
    await ctx.reply(`Projeto "${projectName}" não encontrado.`);
    return;
  }

  try {
    await rm(projectPath, { recursive: true, force: true });

    const session = getSession(chatId);
    if (session.activeProject === projectName) {
      setActiveProject(chatId, null);
    }

    await ctx.reply(`Projeto "${projectName}" removido.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Erro ao remover: ${message}`);
  }
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
  const msg = await ctx.reply(`Dashboard token:\n<code>${token}</code>\n\n<i>Esta mensagem será apagada em 30s.</i>`, { parse_mode: "HTML" });

  setTimeout(async () => {
    try {
      await ctx.api.deleteMessage(chatId, msg.message_id);
    } catch {
      // message already deleted or bot lacks permission
    }
  }, 30_000);
}

// --- Running ---

async function handleRunning(ctx: Context): Promise<void> {
  const activeExecs = executionManager.getActiveExecutions();

  if (activeExecs.length === 0) {
    await ctx.reply("Nenhuma execução em andamento.");
    return;
  }

  const now = Date.now();
  const lines = [`${activeExecs.length} execução(ões) em andamento:\n`];

  for (const exec of activeExecs) {
    const elapsedMs = now - exec.startedAt.getTime();
    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    const elapsed = minutes > 0 ? `há ${minutes}m ${seconds}s` : `há ${seconds}s`;
    const promptPreview = exec.prompt.length > 80
      ? exec.prompt.slice(0, 80) + "..."
      : exec.prompt;

    lines.push(`• [${exec.targetType}] ${exec.targetName}`);
    lines.push(`  ${promptPreview}`);
    lines.push(`  ${elapsed} · fonte: ${exec.source}`);
    lines.push("");
  }

  await ctx.reply(lines.join("\n").trimEnd());
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

  if (isBusy(chatId)) {
    await ctx.reply("Já existe uma execução em andamento. Aguarde ou use /cancel.");
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
