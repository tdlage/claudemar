import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { config } from "../config.js";
import { getAgentPaths, isValidAgentName, listAgents } from "./manager.js";

export interface RouteResult {
  routed: number;
  errors: string[];
  destinations: string[];
}

const OUTBOX_PATTERN = /^PARA-([a-zA-Z0-9._-]+)_(.+)$/;
const INBOX_PATTERN = /^DE-.+\.md$/;

export function routeMessages(sourceAgent: string): RouteResult {
  const paths = getAgentPaths(sourceAgent);
  if (!paths || !existsSync(paths.outbox)) {
    return { routed: 0, errors: [], destinations: [] };
  }

  return routeFromOutbox(paths.outbox, sourceAgent);
}

export function routeOrchestratorMessages(): RouteResult {
  const outboxPath = resolve(config.orchestratorPath, "outbox");
  if (!existsSync(outboxPath)) {
    return { routed: 0, errors: [], destinations: [] };
  }

  return routeFromOutbox(outboxPath, "orchestrator");
}

function routeFromOutbox(outboxPath: string, sourceName: string): RouteResult {
  const result: RouteResult = { routed: 0, errors: [], destinations: [] };
  const destinationSet = new Set<string>();

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

    const sanitizedRest = rest.replace(/[/\\]/g, "_");
    const inboxFilename = `DE-${sourceName}_${sanitizedRest}`;
    const sourcePath = resolve(outboxPath, file);
    const destPath = resolve(destPaths.inbox, inboxFilename);

    if (!destPath.startsWith(destPaths.inbox + sep)) {
      result.errors.push(`Path traversal detectado: ${file}`);
      continue;
    }

    try {
      renameSync(sourcePath, destPath);
      result.routed++;
      destinationSet.add(destinatario);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Erro ao rotear ${file}: ${message}`);
    }
  }

  result.destinations = [...destinationSet];
  return result;
}

export function getInboxMessages(agentName: string): string[] {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.inbox)) return [];

  try {
    return readdirSync(paths.inbox).filter((f) => INBOX_PATTERN.test(f)).sort();
  } catch {
    return [];
  }
}

export function archiveInboxMessages(agentName: string): number {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.inbox)) return 0;

  const processedDir = resolve(paths.inbox, "processed");
  mkdirSync(processedDir, { recursive: true });

  let archived = 0;
  try {
    const files = readdirSync(paths.inbox).filter((f) => INBOX_PATTERN.test(f));
    for (const file of files) {
      const src = resolve(paths.inbox, file);
      const dest = resolve(processedDir, file);
      try {
        renameSync(src, dest);
        archived++;
      } catch {
        // skip individual file errors
      }
    }
  } catch {
    // skip
  }
  return archived;
}

export function buildInboxPrompt(agentName: string): string | null {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.inbox)) return null;

  const files = getInboxMessages(agentName);
  if (files.length === 0) return null;

  const parts: string[] = [
    `You have ${files.length} new message(s) in your inbox. Read and process each one:\n`,
  ];

  for (const file of files) {
    const filePath = resolve(paths.inbox, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      parts.push(`--- ${file} ---\n${content}\n--- end ---\n`);
    } catch {
      parts.push(`--- ${file} ---\n(could not read)\n--- end ---\n`);
    }
  }

  parts.push(
    "For each message, take the appropriate action based on the request.",
    "If a response is needed, write it to your outbox/ using: PARA-<sender>_<timestamp>_<subject>.md",
    "After processing all messages, confirm what you did for each one.",
  );

  return parts.join("\n");
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
