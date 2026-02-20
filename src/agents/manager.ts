import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { config } from "../config.js";
import type { AgentInfo, AgentPaths } from "./types.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_RE.test(name);
}

export function safeAgentPath(name: string): string | null {
  if (!isValidAgentName(name)) return null;
  const resolved = resolve(config.agentsPath, name);
  if (!resolved.startsWith(config.agentsPath + sep)) return null;
  return resolved;
}

export function getAgentPaths(name: string): AgentPaths | null {
  const root = safeAgentPath(name);
  if (!root) return null;
  return {
    root,
    context: resolve(root, "context"),
    inbox: resolve(root, "inbox"),
    outbox: resolve(root, "outbox"),
    output: resolve(root, "output"),
    input: resolve(root, "input"),
  };
}

export function createAgentStructure(name: string): AgentPaths | null {
  const paths = getAgentPaths(name);
  if (!paths) return null;

  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.context, { recursive: true });
  mkdirSync(paths.inbox, { recursive: true });
  mkdirSync(paths.outbox, { recursive: true });
  mkdirSync(paths.output, { recursive: true });
  mkdirSync(paths.input, { recursive: true });

  ensureAgentGitRepo(paths.root);

  return paths;
}

export function ensureAgentGitRepo(agentRoot: string): void {
  if (existsSync(resolve(agentRoot, ".git"))) return;
  try {
    execFileSync("git", ["init"], { cwd: agentRoot, stdio: "ignore" });
  } catch {
    // non-critical
  }
}

export function ensureAllAgentGitRepos(): void {
  for (const name of listAgents()) {
    const root = safeAgentPath(name);
    if (root) ensureAgentGitRepo(root);
  }
}

export function listAgents(): string[] {
  try {
    const entries = readdirSync(config.agentsPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export function getAgentInfo(name: string): AgentInfo | null {
  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) return null;

  let inboxCount = 0;
  try {
    inboxCount = readdirSync(paths.inbox).length;
  } catch {
    // empty
  }

  let lastExecution: Date | null = null;
  try {
    const outputFiles = readdirSync(paths.output);
    for (const file of outputFiles) {
      const filePath = resolve(paths.output, file);
      const stat = statSync(filePath);
      if (!lastExecution || stat.mtime > lastExecution) {
        lastExecution = stat.mtime;
      }
    }
  } catch {
    // empty
  }

  return { name, inboxCount, lastExecution };
}

export function listAgentInfos(): AgentInfo[] {
  return listAgents()
    .map(getAgentInfo)
    .filter((info): info is AgentInfo => info !== null);
}
