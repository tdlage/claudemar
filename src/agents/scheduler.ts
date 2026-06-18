import { existsSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { query, execute, toMySQLDatetime } from "../database.js";
import { config } from "../config.js";
import { getAgentPaths, isValidAgentName } from "./manager.js";
import type { RowDataPacket } from "mysql2/promise";

export interface ScheduleEntry {
  id: string;
  agent: string;
  cron: string;
  cronHuman: string;
  task: string;
  scriptPath: string;
  createdAt: string;
}

interface ScheduleRow extends RowDataPacket {
  id: string;
  agent: string;
  cron: string;
  cron_human: string;
  task: string;
  prompt: string | null;
  script_path: string;
  created_at: string | Date;
}

const SELECT_COLUMNS = "id, agent, cron, cron_human, task, prompt, script_path, created_at";

function rowToEntry(row: ScheduleRow): ScheduleEntry {
  return {
    id: row.id,
    agent: row.agent,
    cron: row.cron,
    cronHuman: row.cron_human,
    task: row.task,
    scriptPath: row.script_path,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function getCurrentCrontab(): string {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf-8" });
  } catch {
    return "";
  }
}

function setCrontab(content: string): void {
  execFileSync("crontab", ["-"], { input: content, encoding: "utf-8" });
}

function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const field = /^(\*|(\d+|\*)(\/\d+)?(-\d+)?)(,(\d+|\*)(\/\d+)?(-\d+)?)*$/;
  return parts.every((p) => field.test(p));
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

function installCron(cron: string, scriptPath: string): void {
  const current = getCurrentCrontab();
  const lines = current.split("\n").filter((l) => l.trim().length > 0 && !l.includes(scriptPath));
  lines.push(`${cron} ${scriptPath}`);
  setCrontab(lines.join("\n") + "\n");
}

export interface CreateScheduleInput {
  agent: string;
  cron: string;
  cronHuman: string;
  task: string;
  prompt: string;
}

export async function createSchedule(input: CreateScheduleInput): Promise<ScheduleEntry> {
  const { agent, cron, cronHuman, task, prompt } = input;

  if (!isValidAgentName(agent)) throw new Error("Nome de agente inválido");
  const paths = getAgentPaths(agent);
  if (!paths || !existsSync(paths.root)) throw new Error(`Agente "${agent}" não encontrado`);
  if (!isValidCron(cron)) throw new Error(`Expressão cron inválida: "${cron}" (esperado 5 campos)`);
  if (!prompt.trim()) throw new Error("prompt é obrigatório");
  if (!task.trim()) throw new Error("task é obrigatório");

  const id = randomUUID().slice(0, 8);
  const schedulesDir = resolve(paths.root, "schedules");
  mkdirSync(schedulesDir, { recursive: true });

  const baseName = `${slugify(task)}-${id}`;
  const scriptPath = resolve(schedulesDir, `${baseName}.sh`);
  const logPath = resolve(schedulesDir, `${baseName}.log`);
  const runnerPath = resolve(config.installDir, "dist", "schedule-run.js");

  const script = `#!/usr/bin/env bash
# Claudemar — tarefa agendada ${id} do agente "${agent}"
# ${cronHuman}
set -euo pipefail
cd "${config.installDir}"
exec "${process.execPath}" "${runnerPath}" "${id}" >> "${logPath}" 2>&1
`;
  writeFileSync(scriptPath, script, { mode: 0o755 });

  const createdAt = new Date().toISOString();
  await execute(
    "INSERT INTO schedules (id, agent, cron, cron_human, task, prompt, script_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, agent, cron, cronHuman, task, prompt, scriptPath, toMySQLDatetime(createdAt)],
  );

  installCron(cron, scriptPath);

  return { id, agent, cron, cronHuman, task, scriptPath, createdAt };
}

export async function getScheduleById(id: string): Promise<(ScheduleEntry & { prompt: string }) | null> {
  const rows = await query<ScheduleRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ?`,
    [id],
  );
  if (rows.length === 0) return null;
  const entry = rowToEntry(rows[0]);
  return { ...entry, prompt: rows[0].prompt ?? rows[0].task };
}

export async function removeSchedule(id: string): Promise<boolean> {
  const rows = await query<ScheduleRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM schedules WHERE id = ?`,
    [id],
  );
  if (rows.length === 0) return false;

  const entry = rowToEntry(rows[0]);

  try {
    if (existsSync(entry.scriptPath)) {
      unlinkSync(entry.scriptPath);
    }
  } catch { }

  try {
    const currentCrontab = getCurrentCrontab();
    const lines = currentCrontab.split("\n");
    const filtered = lines.filter((line) => !line.includes(entry.scriptPath));
    setCrontab(filtered.join("\n") + "\n");
  } catch { }

  await execute("DELETE FROM schedules WHERE id = ?", [id]);
  return true;
}

export async function removeSchedulesByAgent(agent: string): Promise<number> {
  const schedules = await listSchedulesByAgent(agent);
  let removed = 0;
  for (const entry of schedules) {
    if (await removeSchedule(entry.id)) removed++;
  }
  return removed;
}

export async function listSchedulesByAgent(agent: string): Promise<ScheduleEntry[]> {
  const rows = await query<ScheduleRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM schedules WHERE agent = ? ORDER BY created_at DESC`,
    [agent],
  );
  return rows.map(rowToEntry);
}

export function createSchedulerMcpServer(agent: string): ReturnType<typeof createSdkMcpServer> {
  const scheduleTool = tool(
    "schedule_task",
    "Agenda uma tarefa recorrente para este agente executar automaticamente via cron. Use sempre que o usuário pedir algo recorrente ou para rodar em determinado horário (ex.: 'todo dia às 9h faça X', 'toda segunda envie o relatório').",
    {
      cron: z.string().describe("Expressão cron de 5 campos: 'minuto hora dia-do-mês mês dia-da-semana'. Ex.: '0 9 * * *' = todo dia às 9h; '0 8 * * 1' = toda segunda às 8h."),
      schedule_human: z.string().describe("Descrição legível em português de QUANDO a tarefa roda, para um usuário leigo. Ex.: 'Todo dia às 9h da manhã' ou 'Toda segunda-feira às 8h'."),
      task: z.string().describe("Descrição curta e legível em português do QUE a tarefa faz. Ex.: 'Resumir os e-mails novos e enviar por e-mail'."),
      prompt: z.string().describe("O prompt/instrução completo que será enviado ao agente quando a tarefa rodar no horário agendado."),
    },
    async (args) => {
      try {
        const entry = await createSchedule({
          agent,
          cron: args.cron,
          cronHuman: args.schedule_human,
          task: args.task,
          prompt: args.prompt,
        });
        return {
          content: [{
            type: "text" as const,
            text: `Agendamento criado (id ${entry.id}). Quando: ${entry.cronHuman} (cron: ${entry.cron}). O que faz: ${entry.task}.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Falha ao agendar: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  const listTool = tool(
    "list_schedules",
    "Lista as tarefas agendadas atuais deste agente.",
    {},
    async () => {
      const list = await listSchedulesByAgent(agent);
      if (list.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhuma tarefa agendada." }] };
      }
      const text = list
        .map((s) => `- [${s.id}] ${s.cronHuman} (cron ${s.cron}): ${s.task}`)
        .join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  const removeTool = tool(
    "remove_schedule",
    "Remove uma tarefa agendada deste agente pelo seu id.",
    { id: z.string().describe("O id do agendamento (obtido via list_schedules)") },
    async (args) => {
      const ok = await removeSchedule(args.id);
      return {
        content: [{ type: "text" as const, text: ok ? `Agendamento ${args.id} removido.` : `Agendamento ${args.id} não encontrado.` }],
      };
    },
  );

  return createSdkMcpServer({ name: "scheduler", version: "1.0.0", tools: [scheduleTool, listTool, removeTool] });
}
