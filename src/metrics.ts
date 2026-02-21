import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const METRICS_FILE = resolve(config.dataPath, "metrics.json");

export interface AgentMetrics {
  executions: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

export function loadMetrics(): Record<string, AgentMetrics> {
  try {
    if (!existsSync(METRICS_FILE)) return {};
    return JSON.parse(readFileSync(METRICS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveMetrics(metrics: Record<string, AgentMetrics>): void {
  writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2), "utf-8");
}

export function trackExecution(agent: string, costUsd: number, durationMs: number): void {
  const metrics = loadMetrics();
  if (!metrics[agent]) {
    metrics[agent] = { executions: 0, totalCostUsd: 0, totalDurationMs: 0 };
  }
  metrics[agent].executions++;
  metrics[agent].totalCostUsd += costUsd;
  metrics[agent].totalDurationMs += durationMs;
  saveMetrics(metrics);
}
