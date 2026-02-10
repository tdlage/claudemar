import { existsSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { getAgentPaths, isValidAgentName, listAgents } from "./manager.js";

export interface RouteResult {
  routed: number;
  errors: string[];
}

const OUTBOX_PATTERN = /^PARA-([a-zA-Z0-9._-]+)_(.+)$/;

export function routeMessages(sourceAgent: string): RouteResult {
  const paths = getAgentPaths(sourceAgent);
  if (!paths || !existsSync(paths.outbox)) {
    return { routed: 0, errors: [] };
  }

  return routeFromOutbox(paths.outbox, sourceAgent);
}

export function routeOrchestratorMessages(): RouteResult {
  const outboxPath = resolve(config.orchestratorPath, "outbox");
  if (!existsSync(outboxPath)) {
    return { routed: 0, errors: [] };
  }

  return routeFromOutbox(outboxPath, "orchestrator");
}

function routeFromOutbox(outboxPath: string, sourceName: string): RouteResult {
  const result: RouteResult = { routed: 0, errors: [] };

  let files: string[];
  try {
    files = readdirSync(outboxPath);
  } catch {
    return result;
  }

  for (const file of files) {
    const match = OUTBOX_PATTERN.exec(file);
    if (!match) continue;

    const [, destinatario, rest] = match;

    if (!isValidAgentName(destinatario)) {
      result.errors.push(`Destinatário inválido: ${destinatario}`);
      continue;
    }

    const destPaths = getAgentPaths(destinatario);
    if (!destPaths || !existsSync(destPaths.inbox)) {
      result.errors.push(`Agente não encontrado: ${destinatario}`);
      continue;
    }

    const inboxFilename = `DE-${sourceName}_${rest}`;
    const sourcePath = resolve(outboxPath, file);
    const destPath = resolve(destPaths.inbox, inboxFilename);

    try {
      renameSync(sourcePath, destPath);
      result.routed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Erro ao rotear ${file}: ${message}`);
    }
  }

  return result;
}

export function broadcastMessage(content: string): { sent: number; errors: string[] } {
  const agents = listAgents();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `DE-usuario_${timestamp}_broadcast.md`;
  const result = { sent: 0, errors: [] as string[] };

  for (const agent of agents) {
    const paths = getAgentPaths(agent);
    if (!paths) continue;

    try {
      writeFileSync(resolve(paths.inbox, filename), content, "utf-8");
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${agent}: ${message}`);
    }
  }

  return result;
}
