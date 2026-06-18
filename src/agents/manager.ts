import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { config } from "../config.js";
import type { AgentInfo, AgentPaths } from "./types.js";

const AGENT_NAME_RE = /^[a-zA-Z0-9.-]+$/;

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
    output: resolve(root, "output"),
    input: resolve(root, "input"),
  };
}

export function createAgentStructure(name: string): AgentPaths | null {
  const paths = getAgentPaths(name);
  if (!paths) return null;

  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.context, { recursive: true });
  mkdirSync(paths.output, { recursive: true });
  mkdirSync(paths.input, { recursive: true });

  ensureAgentGitRepo(paths.root);

  return paths;
}

export function cleanupLegacyMailboxes(): void {
  const dirs = [config.orchestratorPath, ...listAgents().map((name) => resolve(config.agentsPath, name))];
  let removed = 0;
  for (const dir of dirs) {
    for (const box of ["inbox", "outbox"]) {
      const target = resolve(dir, box);
      if (!existsSync(target)) continue;
      try {
        rmSync(target, { recursive: true, force: true });
        removed++;
      } catch {
        // non-critical
      }
    }
  }
  if (removed > 0) console.log(`[migrate] Removed ${removed} legacy inbox/outbox folder(s)`);
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

  return { name, lastExecution };
}

export function listAgentInfos(): AgentInfo[] {
  return listAgents()
    .map(getAgentInfo)
    .filter((info): info is AgentInfo => info !== null);
}

export function summarizeAgentsMd(content: string): string | null {
  const lines = content.split("\n");

  let title = "";
  const descLines: string[] = [];
  let pastTitle = false;

  for (const line of lines) {
    if (!pastTitle) {
      if (line.startsWith("# ")) {
        title = line.replace(/^#\s+/, "").trim();
        pastTitle = true;
      }
      continue;
    }
    if (line.startsWith("## ")) break;
    const trimmed = line.trim();
    if (trimmed) descLines.push(trimmed);
  }

  if (!title) return null;
  const desc = descLines.slice(0, 3).join(" ");
  return desc ? `**${title}**\n${desc}` : `**${title}**`;
}

export function extractAgentSummary(name: string): string | null {
  const agentsMdPath = resolve(config.agentsPath, name, "AGENTS.md");
  if (!existsSync(agentsMdPath)) return null;
  return summarizeAgentsMd(readFileSync(agentsMdPath, "utf-8"));
}
