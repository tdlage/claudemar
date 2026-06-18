import { existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { query, execute } from "../database.js";
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
  script_path: string;
  created_at: string | Date;
}

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

export async function removeSchedule(id: string): Promise<boolean> {
  const rows = await query<ScheduleRow[]>(
    "SELECT id, agent, cron, cron_human, task, script_path, created_at FROM schedules WHERE id = ?",
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
    "SELECT id, agent, cron, cron_human, task, script_path, created_at FROM schedules WHERE agent = ?",
    [agent],
  );
  return rows.map(rowToEntry);
}
