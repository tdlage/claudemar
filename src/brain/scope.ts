import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { usersManager } from "../users-manager.js";
import type { Requester } from "../requester.js";

export const ADMIN_BRAIN = "admin";

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Tudo o que identifica o armazenamento de um brain. Nenhum módulo do brain monta caminho, chave do
 * Redis, filtro do Qdrant ou prefixo de objeto sem passar por um escopo — é isso que isola os donos.
 */
export interface BrainScope {
  readonly owner: string;
  readonly isAdmin: boolean;
  readonly root: string;
  readonly rawDir: string;
  readonly wikiDir: string;
  readonly stateDir: string;
  readonly quarantineDir: string;
  readonly quarantineDiscardedDir: string;
  readonly attachmentsDir: string;
  readonly telemetryDir: string;
  readonly privateDir: string;
  readonly settingsFile: string;
  readonly googleTokensDir: string;
  readonly slackTokensFile: string;
  readonly mcpAuditFile: string;
  readonly keyPrefix: string;
  readonly indexType: string;
  readonly objectPrefix: string;
}

export function isBrainOwnerId(owner: unknown): owner is string {
  return owner === ADMIN_BRAIN || (typeof owner === "string" && USER_ID_RE.test(owner));
}

function buildScope(owner: string): BrainScope {
  const isAdmin = owner === ADMIN_BRAIN;
  const root = isAdmin ? config.brainRoot : resolve(config.brainUsersRoot, owner);
  const privateDir = isAdmin ? config.dataPath : resolve(config.dataPath, "brain-users", owner);
  const stateDir = resolve(root, "state");
  const quarantineDir = resolve(stateDir, "quarantine");
  return Object.freeze({
    owner,
    isAdmin,
    root,
    rawDir: resolve(root, "raw"),
    wikiDir: resolve(root, "wiki"),
    stateDir,
    quarantineDir,
    quarantineDiscardedDir: resolve(quarantineDir, ".discarded"),
    attachmentsDir: resolve(root, "attachments"),
    telemetryDir: resolve(stateDir, "telemetry"),
    privateDir,
    settingsFile: resolve(privateDir, isAdmin ? "brain-settings.json" : "settings.json"),
    googleTokensDir: resolve(privateDir, isAdmin ? "brain-google-tokens" : "google-tokens"),
    slackTokensFile: resolve(privateDir, isAdmin ? "brain-slack-tokens.json" : "slack-tokens.json"),
    mcpAuditFile: resolve(privateDir, isAdmin ? "brain-mcp-audit.jsonl" : "mcp-audit.jsonl"),
    keyPrefix: isAdmin ? "brain:" : `brain:user:${owner}:`,
    indexType: isAdmin ? "brain" : `brain:user:${owner}`,
    objectPrefix: isAdmin ? "" : `users/${owner}/`,
  });
}

const scopes = new Map<string, BrainScope>();
const forgetHooks: ((owner: string) => void)[] = [];

export function brainScope(owner: string): BrainScope {
  if (!isBrainOwnerId(owner)) throw new Error(`dono de brain inválido: ${owner}`);
  let scope = scopes.get(owner);
  if (!scope) {
    scope = buildScope(owner);
    scopes.set(owner, scope);
  }
  return scope;
}

export function adminBrain(): BrainScope {
  return brainScope(ADMIN_BRAIN);
}

/** Só usuário existente tem brain: id órfão (usuário removido) nunca resolve para um escopo. */
export function userBrain(userId: string): BrainScope | null {
  if (!USER_ID_RE.test(userId) || !usersManager.get(userId)) return null;
  return brainScope(userId);
}

/** Identidades sintéticas (pipeline, agendamento legado) não pertencem a ninguém e não recebem brain. */
export function brainForRequester(requester: Requester): BrainScope | null {
  if (requester.role === "admin") return adminBrain();
  return requester.userId ? userBrain(requester.userId) : null;
}

export function brainOwnerLabel(owner: string): string {
  if (owner === ADMIN_BRAIN) return "admin";
  return usersManager.get(owner)?.name ?? owner;
}

export function listBrainOwners(): string[] {
  return [ADMIN_BRAIN, ...usersManager.getAll().map((user) => user.id)];
}

export function brainExists(scope: BrainScope): boolean {
  return existsSync(resolve(scope.root, ".git"));
}

export function onBrainScopeForgotten(hook: (owner: string) => void): void {
  forgetHooks.push(hook);
}

export function forgetBrainScope(owner: string): void {
  scopes.delete(owner);
  for (const hook of forgetHooks) hook(owner);
}

/** Estado em memória de um módulo, separado por dono e descartado quando o dono é removido. */
export function perScope<T>(init: (scope: BrainScope) => T): (scope: BrainScope) => T {
  const states = new Map<string, T>();
  onBrainScopeForgotten((owner) => states.delete(owner));
  return (scope) => {
    let state = states.get(scope.owner);
    if (state === undefined) {
      state = init(scope);
      states.set(scope.owner, state);
    }
    return state;
  };
}
