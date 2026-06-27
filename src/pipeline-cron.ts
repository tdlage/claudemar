import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const CRON_DIR = resolve(config.dataPath, "pipeline-intake");
const MARKER = "# claudemar-pipeline-intake";

function getCrontab(): string {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf-8" });
  } catch {
    return "";
  }
}

function setCrontab(content: string): void {
  execFileSync("crontab", ["-"], { input: content, encoding: "utf-8" });
}

const CRON_BOUNDS: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function validCronSegment(seg: string, [min, max]: [number, number]): boolean {
  const m = seg.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
  if (!m) return false;
  const step = m[2];
  if (step !== undefined && (Number(step) <= 0)) return false;
  if (m[1] === "*") return true;
  const range = m[1].split("-").map(Number);
  if (range.some((n) => n < min || n > max)) return false;
  return range.length === 1 || range[0] <= range[1];
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p, i) => p.split(",").every((seg) => validCronSegment(seg, CRON_BOUNDS[i])));
}

export function installPipelineCron(pluginId: string, cron: string): void {
  if (!isValidCron(cron)) throw new Error(`Expressão cron inválida: "${cron}" (esperado 5 campos)`);
  mkdirSync(CRON_DIR, { recursive: true });

  const scriptPath = resolve(CRON_DIR, `${pluginId}.sh`);
  const logPath = resolve(CRON_DIR, `${pluginId}.log`);
  const runnerPath = resolve(config.installDir, "dist", "pipeline-intake-run.js");

  const script = `#!/usr/bin/env bash
# Claudemar — intake agendado do plugin ${pluginId}
set -euo pipefail
cd "${config.installDir}"
exec "${process.execPath}" "${runnerPath}" "${pluginId}" >> "${logPath}" 2>&1
`;
  writeFileSync(scriptPath, script, { mode: 0o755 });

  const tag = `${MARKER} ${pluginId}`;
  const lines = getCrontab().split("\n").filter((l) => l.trim().length > 0 && !l.includes(tag));
  lines.push(`${cron} ${scriptPath} ${tag}`);
  setCrontab(lines.join("\n") + "\n");
}

export function removePipelineCron(pluginId: string): void {
  const scriptPath = resolve(CRON_DIR, `${pluginId}.sh`);
  try {
    if (existsSync(scriptPath)) unlinkSync(scriptPath);
  } catch { /* ignore */ }

  const tag = `${MARKER} ${pluginId}`;
  try {
    const lines = getCrontab().split("\n").filter((l) => l.trim().length > 0 && !l.includes(tag));
    setCrontab(lines.join("\n") + "\n");
  } catch { /* ignore */ }
}
