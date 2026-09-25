import { relative, resolve, sep } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { config } from "../../config.js";
import { query } from "../../database.js";
import { listProjects } from "../../session.js";
import { listAgents } from "../../agents/manager.js";
import { PIPELINE_WORKTREES_ROOT } from "../../pipeline-worktree.js";
import { brainSettingsManager } from "../settings.js";
import { canonicalTenant, resolveTenantName, ROOT_TENANT } from "../tenants.js";
import { slugify } from "../text.js";

import { ORCHESTRATOR_TARGET, parseTargetKey, targetKey, type ClaudemarTarget } from "./managed.js";

export {
  ORCHESTRATOR_TARGET,
  parseTargetKey,
  targetKey,
  type ClaudemarTarget,
} from "./managed.js";

const COMMIT_PUSH_PREFIX = "__commitpush:";
const HANDLE_PREFIX = "claudemar:";

export function targetHandle(target: ClaudemarTarget): string {
  return `${HANDLE_PREFIX}${targetKey(target)}`;
}

/** Só o participante com papel "agent" é o alvo: autores de commit e de comentários vêm de fora e não decidem isso. */
export function targetFromParticipants(participants: { handle: string; role: string }[]): ClaudemarTarget | null {
  const agents = participants
    .filter((p) => p.role === "agent" && p.handle.startsWith(HANDLE_PREFIX))
    .map((p) => parseTargetKey(p.handle.slice(HANDLE_PREFIX.length)))
    .filter((t): t is ClaudemarTarget => t !== null);
  const keys = new Set(agents.map(targetKey));
  return keys.size === 1 ? agents[0] : null;
}

export function targetLabel(target: ClaudemarTarget): string {
  if (target.kind === "orchestrator") return "Orquestrador";
  return target.kind === "project" ? `Projeto ${target.name}` : `Agente ${target.name}`;
}

export function targetPagePath(target: ClaudemarTarget): string {
  if (target.kind === "orchestrator") return "wiki/projects/claudemar-orquestrador.md";
  const prefix = target.kind === "project" ? "projeto" : "agente";
  return `wiki/projects/claudemar-${prefix}-${slugify(target.name, 60)}.md`;
}

export function targetRoot(target: ClaudemarTarget): string {
  if (target.kind === "orchestrator") return config.orchestratorPath;
  return resolve(target.kind === "project" ? config.projectsPath : config.agentsPath, target.name);
}

export function targetFromExecution(targetType: string, targetName: string): ClaudemarTarget | null {
  if (targetType === "orchestrator") return ORCHESTRATOR_TARGET;
  if (targetType === "agent") return parseTargetKey(`agent:${targetName}`);
  if (targetType !== "project") return null;
  const name = targetName.startsWith(COMMIT_PUSH_PREFIX) ? targetName.slice(COMMIT_PUSH_PREFIX.length).split(":")[0] : targetName;
  return parseTargetKey(`project:${name}`);
}

function firstSegmentUnder(base: string, path: string): string | null {
  const rel = relative(base, path);
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return null;
  return rel.split(sep)[0] || null;
}

export async function targetFromCwd(cwd: string): Promise<ClaudemarTarget | null> {
  const path = resolve(cwd);
  if (path === config.orchestratorPath || path.startsWith(config.orchestratorPath + sep)) return ORCHESTRATOR_TARGET;
  const project = firstSegmentUnder(config.projectsPath, path);
  if (project) return parseTargetKey(`project:${project}`);
  const agent = firstSegmentUnder(config.agentsPath, path);
  if (agent) return parseTargetKey(`agent:${agent}`);
  const cardId = firstSegmentUnder(PIPELINE_WORKTREES_ROOT, path);
  if (!cardId) return null;
  const rows = await query<(RowDataPacket & { project_name: string })[]>(
    `SELECT p.project_name FROM pipeline_cards c JOIN pipeline_pipelines p ON p.id = c.pipeline_id WHERE c.id = ?`,
    [cardId],
  );
  return rows[0] ? parseTargetKey(`project:${rows[0].project_name}`) : null;
}

export function listTargets(): ClaudemarTarget[] {
  const parsed = (keys: string[]) => keys.map(parseTargetKey).filter((t): t is ClaudemarTarget => t !== null);
  return [
    ORCHESTRATOR_TARGET,
    ...parsed(listProjects().sort().map((name) => `project:${name}`)),
    ...parsed(listAgents().sort().map((name) => `agent:${name}`)),
  ];
}

export function isTargetExcluded(target: ClaudemarTarget): boolean {
  return brainSettingsManager.get().claudemar.excludedTargets.includes(targetKey(target));
}

/**
 * Contexto fixo por alvo: sessões do mesmo projeto precisam cair na mesma árvore de contexto,
 * senão a validação de isolamento rejeita as compilações que atualizam a página do alvo.
 */
export async function targetTenant(target: ClaudemarTarget): Promise<string> {
  const mapped = brainSettingsManager.get().claudemar.tenants[targetKey(target)];
  if (mapped) return canonicalTenant(mapped);
  if (target.kind !== "orchestrator") {
    const byName = await resolveTenantName(target.name);
    if (byName) return byName;
  }
  return ROOT_TENANT;
}
