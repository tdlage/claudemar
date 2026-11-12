import { DEFAULT_PROJECT_TABS, usersManager, type ProjectTabKey } from "../../users-manager.js";
import type { HistoryOwner } from "../../history.js";
import type { BrainScope } from "../scope.js";
import { listTargets, targetKey, type ClaudemarTarget } from "./targets.js";

/**
 * O que o canal claudemar de um brain pode ver. O admin vê o que é dele (dashboard do admin, Telegram,
 * agendamentos e pipeline) em todos os alvos. Um usuário vê só as próprias execuções, e só nos projetos
 * e agentes a que ainda tem acesso; cards e commits seguem as abas liberadas para ele no projeto.
 */
export interface ClaudemarAccess {
  history: HistoryOwner;
  targets: ClaudemarTarget[];
  allows(target: ClaudemarTarget): boolean;
  cards(target: ClaudemarTarget): boolean;
  commits(target: ClaudemarTarget): boolean;
  instructions: boolean;
  orphanSessions: boolean;
  ownCard(createdBy: string): boolean;
}

const NO_ACCESS: ClaudemarAccess = {
  history: { kind: "user", userId: "" },
  targets: [],
  allows: () => false,
  cards: () => false,
  commits: () => false,
  instructions: false,
  orphanSessions: false,
  ownCard: () => false,
};

export function claudemarAccess(scope: BrainScope): ClaudemarAccess {
  if (scope.isAdmin) {
    return {
      history: { kind: "admin" },
      targets: listTargets(),
      allows: () => true,
      cards: (target) => target.kind === "project",
      commits: () => true,
      instructions: true,
      orphanSessions: true,
      ownCard: (createdBy) => createdBy.toLowerCase() === "admin",
    };
  }
  const user = usersManager.get(scope.owner);
  if (!user) return NO_ACCESS;
  const projects = new Set(user.projects);
  const agents = new Set(user.agents);
  const targets = listTargets().filter((target) =>
    target.kind === "project" ? projects.has(target.name) : target.kind === "agent" ? agents.has(target.name) : false,
  );
  const allowed = new Set(targets.map(targetKey));
  const tab = (target: ClaudemarTarget, key: ProjectTabKey): boolean =>
    target.kind === "project" && allowed.has(targetKey(target)) && (user.projectTabs[target.name] ?? DEFAULT_PROJECT_TABS).includes(key);
  return {
    history: { kind: "user", userId: user.id },
    targets,
    allows: (target) => allowed.has(targetKey(target)),
    cards: (target) => tab(target, "pipeline"),
    commits: (target) => tab(target, "repositories"),
    instructions: false,
    orphanSessions: false,
    ownCard: () => false,
  };
}
