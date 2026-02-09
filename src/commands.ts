import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { type Bot, type Context, InlineKeyboard, InputFile } from "grammy";
import { config } from "./config.js";
import { executeShell, executeSpawn } from "./executor.js";
import {
  getActiveProcess,
  getSession,
  getWorkingDirectory,
  isValidProjectName,
  listProjects,
  safeProjectPath,
  setActiveProject,
  setBusy,
} from "./session.js";

const HELP_TEXT = [
  "/project — Selecionar projeto ativo",
  "/current — Projeto e sessão atuais",
  "/clear — Resetar para orchestrator",
  "/cancel — Cancelar execução em andamento",
  "/exec <cmd> — Executar comando shell",
  "/git <subcmd> — Executar comando git",
  "/add <url> [nome] — Clonar repositório",
  "/remove <projeto> — Remover projeto",
  "/help — Lista de comandos",
].join("\n");

export function registerCommands(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("project", handleProject);
  bot.command("current", handleCurrent);
  bot.command("clear", handleClear);
  bot.command("cancel", handleCancel);
  bot.command("exec", handleExec);
  bot.command("git", handleGit);
  bot.command("add", handleAdd);
  bot.command("remove", handleRemove);
  bot.command("help", handleHelp);
  bot.callbackQuery(/^select_project:/, handleSelectProject);
}

async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(`Claudemar — Telegram interface for Claude CLI\n\n${HELP_TEXT}`);
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
  await ctx.answerCallbackQuery({ text: `${projectName} selecionado` });
  await ctx.editMessageText(
    `Projeto ativo: ${projectName}\nSessão resetada.`,
  );
}

async function handleCurrent(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = getSession(chatId);
  const project = session.activeProject ?? "Orchestrator (padrão)";
  const sessionId = session.sessionId ?? "nenhuma";
  const cwd = getWorkingDirectory(chatId);

  await ctx.reply(
    [`Projeto: ${project}`, `Sessão: ${sessionId}`, `Dir: ${cwd}`].join("\n"),
  );
}

async function handleClear(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  setActiveProject(chatId, null);
  await ctx.reply("Resetado para Orchestrator. Sessão limpa.");
}

async function handleCancel(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const proc = getActiveProcess(chatId);
  if (!proc) {
    await ctx.reply("Nenhuma execução em andamento.");
    return;
  }

  proc.kill("SIGTERM");
  setTimeout(() => {
    if (!proc.killed) {
      proc.kill("SIGKILL");
    }
  }, 5000);

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
    `Comandos disponíveis:\n\n${HELP_TEXT}\n\nEnvie qualquer texto para conversar com o Claude no projeto ativo.`,
  );
}
