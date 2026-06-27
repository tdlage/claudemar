import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { executeSpawn } from "./executor.js";
import { config } from "./config.js";

export const PIPELINE_WORKTREES_ROOT = resolve(config.dataPath, "pipeline-worktrees");

export function cardWorktreeRoot(cardId: string): string {
  return resolve(PIPELINE_WORKTREES_ROOT, cardId);
}

export function cardRepoWorktreePath(cardId: string, repoName: string): string {
  return resolve(cardWorktreeRoot(cardId), repoName === "." ? "root" : repoName);
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "card";
}

export function pipelineBranchName(seq: number, title: string): string {
  return `pipeline/${seq}-${slugify(title)}`;
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await executeSpawn("git", ["-C", repoPath, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repoPath, 5000).catch(() => null);
  return result?.exitCode === 0;
}

async function resolveStartPoint(repoPath: string, baseBranch: string): Promise<string> {
  await executeSpawn("git", ["-C", repoPath, "fetch", "origin", baseBranch], repoPath, 60000).catch(() => null);
  for (const ref of [`origin/${baseBranch}`, baseBranch, "HEAD"]) {
    const ok = await executeSpawn("git", ["-C", repoPath, "rev-parse", "--verify", "--quiet", ref], repoPath, 5000).catch(() => null);
    if (ok?.exitCode === 0) return ref;
  }
  return "HEAD";
}

export async function ensureWorktree(repoPath: string, baseBranch: string, branch: string, destPath: string): Promise<void> {
  if (existsSync(resolve(destPath, ".git"))) return;

  if (await branchExists(repoPath, branch)) {
    const { output, exitCode } = await executeSpawn("git", ["-C", repoPath, "worktree", "add", destPath, branch], repoPath, 60000);
    if (exitCode !== 0) throw new Error(`worktree add falhou (${branch}): ${output}`);
    return;
  }

  const startPoint = await resolveStartPoint(repoPath, baseBranch);
  const { output, exitCode } = await executeSpawn("git", ["-C", repoPath, "worktree", "add", "-b", branch, destPath, startPoint], repoPath, 60000);
  if (exitCode !== 0) throw new Error(`worktree add -b falhou (${branch}): ${output}`);
}

export async function removeWorktree(repoPath: string, destPath: string, branch: string | null): Promise<void> {
  await executeSpawn("git", ["-C", repoPath, "worktree", "remove", "--force", destPath], repoPath, 30000).catch(() => null);
  await executeSpawn("git", ["-C", repoPath, "worktree", "prune"], repoPath, 15000).catch(() => null);
  if (branch) {
    await executeSpawn("git", ["-C", repoPath, "branch", "-D", branch], repoPath, 15000).catch(() => null);
  }
  if (existsSync(destPath)) {
    await rm(destPath, { recursive: true, force: true }).catch(() => null);
  }
}

export async function removeCardWorktreeRoot(cardId: string): Promise<void> {
  const root = cardWorktreeRoot(cardId);
  if (existsSync(root)) {
    await rm(root, { recursive: true, force: true }).catch(() => null);
  }
}
