import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { spawnClaude } from "../executor.js";
import { getAgentPaths } from "./manager.js";

export interface ScheduleEntry {
  id: string;
  agent: string;
  cron: string;
  cronHuman: string;
  task: string;
  scriptPath: string;
  createdAt: string;
}

const SCHEDULES_FILE = resolve(config.dataPath, "schedules.json");

function loadSchedules(): ScheduleEntry[] {
  try {
    if (!existsSync(SCHEDULES_FILE)) return [];
    const raw = readFileSync(SCHEDULES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSchedules(entries: ScheduleEntry[]): void {
  writeFileSync(SCHEDULES_FILE, JSON.stringify(entries, null, 2), "utf-8");
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function createSchedule(
  agent: string,
  naturalLanguageInput: string,
  chatId: number,
): Promise<ScheduleEntry> {
  const agentPaths = getAgentPaths(agent);
  if (!agentPaths) throw new Error(`Agente inválido: ${agent}`);
  if (!existsSync(agentPaths.root)) throw new Error(`Agente não encontrado: ${agent}`);

  const parsePrompt = `Extraia da instrução abaixo APENAS a expressão cron e a tarefa separadamente.
Responda em JSON: { "cron": "<expr>", "task": "<tarefa>" }

Instrução: "${naturalLanguageInput}"

Exemplos:
- "todo dia as 9h mande o fluxo de caixa" → { "cron": "0 9 * * *", "task": "Envie o fluxo de caixa" }
- "toda segunda as 8h revise o pipeline" → { "cron": "0 8 * * 1", "task": "Revise o pipeline" }
- "a cada 6 horas verifique os alertas" → { "cron": "0 */6 * * *", "task": "Verifique os alertas" }

Responda APENAS com o JSON, sem explicações ou markdown.`;

  const parseHandle = spawnClaude(parsePrompt, config.orchestratorPath, null, 30000);
  const parseResult = await parseHandle.promise;

  let cron: string;
  let task: string;
  const CRON_RE = /^[0-9*,/\-]+\s+[0-9*,/\-]+\s+[0-9*,/\-]+\s+[0-9*,/\-]+\s+[0-9*,/\-]+$/;
  try {
    const jsonMatch = parseResult.output.match(/\{[^}]+\}/);
    if (!jsonMatch) throw new Error("JSON não encontrado");
    const parsed = JSON.parse(jsonMatch[0]);
    cron = String(parsed.cron ?? "").trim();
    task = String(parsed.task ?? "").trim();
    if (!cron || !task) throw new Error("Campos cron/task ausentes");
    if (!CRON_RE.test(cron)) throw new Error(`Expressão cron inválida: ${cron}`);
  } catch {
    throw new Error(`Não foi possível interpretar a instrução. Output: ${parseResult.output}`);
  }

  const scriptPrompt = `Construa um script bash que executa a seguinte tarefa: "${task}".

O script deve:
1. Executar o necessário para cumprir a tarefa (pode usar claude CLI neste workspace)
2. Salvar resultado em ./output/scheduled-${slugify(task)}-$(date +%Y%m%d-%H%M).md
3. Enviar notificação via: curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \\
   -d "chat_id=$ALLOWED_CHAT_ID" -d "text=<resumo do resultado>"

Variáveis de ambiente disponíveis: TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_ID
Workspace: ${agentPaths.root}

Responda APENAS com o conteúdo do script, sem explicações. Comece com #!/usr/bin/env bash`;

  const scriptHandle = spawnClaude(scriptPrompt, agentPaths.root, null, 60000);
  const scriptResult = await scriptHandle.promise;

  const scriptContent = extractScript(scriptResult.output);
  if (!scriptContent) {
    throw new Error("Não foi possível extrair o script do output do agente.");
  }

  const schedulesDir = resolve(agentPaths.root, "schedules");
  mkdirSync(schedulesDir, { recursive: true });

  const slug = slugify(task);
  const id = randomUUID().slice(0, 8);
  const scriptPath = resolve(schedulesDir, `${slug}-${id}.sh`);

  writeFileSync(scriptPath, scriptContent, "utf-8");
  chmodSync(scriptPath, 0o755);

  const logPath = resolve(schedulesDir, `${slug}-${id}.log`);
  const envFile = resolve(config.installDir, ".env");
  const cronLine = `${cron} cd ${agentPaths.root} && set -a && . ${envFile} && set +a && bash ${scriptPath} >> ${logPath} 2>&1`;

  const currentCrontab = getCurrentCrontab();
  const newCrontab = currentCrontab.trimEnd() + "\n" + cronLine + "\n";
  setCrontab(newCrontab);

  const entry: ScheduleEntry = {
    id,
    agent,
    cron,
    cronHuman: naturalLanguageInput,
    task,
    scriptPath,
    createdAt: new Date().toISOString(),
  };

  const schedules = loadSchedules();
  schedules.push(entry);
  saveSchedules(schedules);

  return entry;
}

function extractScript(output: string): string | null {
  const shebangIndex = output.indexOf("#!/");
  if (shebangIndex === -1) return null;
  return output.slice(shebangIndex).trim();
}

export function listSchedules(): ScheduleEntry[] {
  return loadSchedules();
}

export function removeSchedule(id: string): boolean {
  const schedules = loadSchedules();
  const entryIndex = schedules.findIndex((e) => e.id === id);
  if (entryIndex === -1) return false;

  const entry = schedules[entryIndex];

  try {
    if (existsSync(entry.scriptPath)) {
      unlinkSync(entry.scriptPath);
    }
  } catch {
    // script already gone
  }

  try {
    const currentCrontab = getCurrentCrontab();
    const lines = currentCrontab.split("\n");
    const filtered = lines.filter((line) => !line.includes(entry.scriptPath));
    setCrontab(filtered.join("\n") + "\n");
  } catch {
    // crontab update failed
  }

  schedules.splice(entryIndex, 1);
  saveSchedules(schedules);
  return true;
}

export function removeSchedulesByAgent(agent: string): number {
  const schedules = loadSchedules();
  const agentSchedules = schedules.filter((e) => e.agent === agent);

  let removed = 0;
  for (const entry of agentSchedules) {
    if (removeSchedule(entry.id)) removed++;
  }

  return removed;
}

export function listSchedulesByAgent(agent: string): ScheduleEntry[] {
  return loadSchedules().filter((e) => e.agent === agent);
}
