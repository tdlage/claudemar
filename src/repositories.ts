import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { rm } from "node:fs/promises";
import { executeSpawn } from "./executor.js";
import { ensureWorktree, removeWorktree, slugify } from "./pipeline-worktree.js";
import { config } from "./config.js";

export interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  remoteUrl: string;
  hasChanges: boolean;
}

export interface RepoCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

const REPO_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const ALLOWED_URL_RE = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/;
const LOG_SEPARATOR = "\x00";

function isGitRepo(dir: string): boolean {
  try {
    return statSync(resolve(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

async function getGitInfo(repoPath: string): Promise<{ branch: string; remoteUrl: string; hasChanges: boolean }> {
  let branch = "";
  let remoteUrl = "";
  let hasChanges = false;

  try {
    const branchResult = await executeSpawn("git", ["branch", "--show-current"], repoPath, 5000);
    branch = branchResult.output.trim();
  } catch { /* detached HEAD or not a repo */ }

  try {
    const remoteResult = await executeSpawn("git", ["remote", "get-url", "origin"], repoPath, 5000);
    remoteUrl = remoteResult.output.trim();
  } catch { /* no remote */ }

  try {
    const statusResult = await executeSpawn("git", ["status", "--porcelain"], repoPath, 5000);
    hasChanges = statusResult.output.trim().length > 0;
  } catch { /* not a repo */ }

  return { branch, remoteUrl, hasChanges };
}

export async function discoverRepos(projectPath: string): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];

  if (isGitRepo(projectPath)) {
    const info = await getGitInfo(projectPath);
    repos.push({
      name: ".",
      path: projectPath,
      branch: info.branch,
      remoteUrl: info.remoteUrl,
      hasChanges: info.hasChanges,
    });
  }

  try {
    const entries = readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subdir = resolve(projectPath, entry.name);
      if (!isGitRepo(subdir)) continue;
      const info = await getGitInfo(subdir);
      repos.push({
        name: entry.name,
        path: subdir,
        branch: info.branch,
        remoteUrl: info.remoteUrl,
        hasChanges: info.hasChanges,
      });
    }
  } catch { /* can't read dir */ }

  return repos;
}

export async function cloneRepo(projectPath: string, url: string, name?: string): Promise<string> {
  if (!ALLOWED_URL_RE.test(url)) {
    throw new Error("URL inválida. Apenas HTTPS, SSH e git:// são permitidos.");
  }

  const repoName = name || url.split("/").pop()?.replace(/\.git$/, "") || "repo";

  if (!REPO_NAME_RE.test(repoName)) {
    throw new Error("Nome de repositório inválido. Use apenas letras, números, '.', '-' e '_'.");
  }

  const targetPath = resolve(projectPath, repoName);
  if (!targetPath.startsWith(projectPath + sep) && targetPath !== projectPath) {
    throw new Error("Path traversal detectado.");
  }

  try {
    statSync(targetPath);
    throw new Error(`Diretório "${repoName}" já existe.`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("já existe")) throw err;
  }

  const { output, exitCode } = await executeSpawn(
    "git",
    ["clone", url, targetPath],
    projectPath,
    120000,
  );

  if (exitCode !== 0) {
    throw new Error(`Clone falhou: ${output}`);
  }

  return repoName;
}

export async function removeRepo(projectPath: string, repoName: string): Promise<void> {
  if (!REPO_NAME_RE.test(repoName)) {
    throw new Error("Nome de repositório inválido.");
  }

  if (repoName === ".") {
    throw new Error("Não é possível remover o repositório raiz.");
  }

  const targetPath = resolve(projectPath, repoName);
  if (!targetPath.startsWith(projectPath + sep)) {
    throw new Error("Path traversal detectado.");
  }

  if (!isGitRepo(targetPath)) {
    throw new Error(`"${repoName}" não é um repositório git.`);
  }

  await rm(targetPath, { recursive: true, force: true });
}

export async function getRepoLog(repoPath: string, limit = 20): Promise<RepoCommit[]> {
  const { output } = await executeSpawn(
    "git",
    ["log", `--pretty=format:%H${LOG_SEPARATOR}%s${LOG_SEPARATOR}%an${LOG_SEPARATOR}%ai`, `-${limit}`],
    repoPath,
    10000,
  );

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(LOG_SEPARATOR);
      return {
        hash: parts[0] ?? "",
        message: parts[1] ?? "",
        author: parts[2] ?? "",
        date: parts[3] ?? "",
      };
    });
}

export async function getRepoBranches(repoPath: string): Promise<{ current: string; branches: string[] }> {
  const { output: currentOutput } = await executeSpawn(
    "git",
    ["branch", "--show-current"],
    repoPath,
    5000,
  );

  const { output: branchOutput } = await executeSpawn(
    "git",
    ["branch", "-a"],
    repoPath,
    10000,
  );

  const current = currentOutput.trim();
  const branches = branchOutput
    .trim()
    .split("\n")
    .map((b) => b.replace(/^\*?\s+/, "").trim())
    .filter(Boolean);

  return { current, branches };
}

export async function checkoutBranch(repoPath: string, branch: string): Promise<string> {
  if (!branch || branch.startsWith("-")) {
    throw new Error("Nome de branch inválido.");
  }

  const { output, exitCode } = await executeSpawn(
    "git",
    ["switch", branch],
    repoPath,
    15000,
  );

  if (exitCode !== 0) {
    throw new Error(`Checkout falhou: ${output}`);
  }

  return output.trim();
}

export async function pullRepo(repoPath: string): Promise<string> {
  const { output, exitCode } = await executeSpawn(
    "git",
    ["pull"],
    repoPath,
    30000,
  );

  if (exitCode !== 0) {
    throw new Error(`Pull falhou: ${output}`);
  }

  return output.trim();
}

export async function stashRepo(repoPath: string, pop = false): Promise<string> {
  const args = pop ? ["stash", "pop"] : ["stash"];
  const { output, exitCode } = await executeSpawn(
    "git",
    args,
    repoPath,
    15000,
  );

  if (exitCode !== 0) {
    throw new Error(`Stash ${pop ? "pop" : ""} falhou: ${output}`);
  }

  return output.trim();
}

export async function fetchRepo(repoPath: string): Promise<string> {
  const { output, exitCode } = await executeSpawn(
    "git",
    ["fetch", "--all"],
    repoPath,
    30000,
  );

  if (exitCode !== 0) {
    throw new Error(`Fetch falhou: ${output}`);
  }

  return output.trim();
}

export interface GitFileStatus {
  status: string;
  path: string;
}

export async function getRepoStatus(repoPath: string): Promise<GitFileStatus[]> {
  const { output } = await executeSpawn(
    "git",
    ["status", "--porcelain"],
    repoPath,
    10000,
  );

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.{1,2})\s(.+)$/);
      if (!match) return null;
      const [, xy, filePath] = match;

      let status: string;
      if (xy === "??" || xy === "?") status = "?";
      else if (xy.includes("D")) status = "D";
      else if (xy.includes("A")) status = "A";
      else if (xy.includes("R")) status = "R";
      else if (xy.includes("M") || xy.includes("m")) status = "M";
      else status = xy.trim() || "M";

      return { status, path: filePath.trim() };
    })
    .filter((entry): entry is GitFileStatus => entry !== null);
}

export async function getFileDiff(repoPath: string, filePath: string): Promise<{ original: string; modified: string }> {
  if (filePath.includes("..") || filePath.startsWith("/")) {
    throw new Error("Invalid file path");
  }

  const absolutePath = resolve(repoPath, filePath);
  if (!absolutePath.startsWith(repoPath + sep) && absolutePath !== repoPath) {
    throw new Error("Path traversal detected");
  }

  let original = "";
  try {
    const result = await executeSpawn(
      "git",
      ["show", `HEAD:${filePath}`],
      repoPath,
      10000,
    );
    if (result.exitCode === 0) {
      original = result.output;
    }
  } catch {
    // file doesn't exist in HEAD (new file)
  }

  let modified = "";
  try {
    if (existsSync(absolutePath)) {
      modified = readFileSync(absolutePath, "utf-8");
    }
  } catch {
    // file deleted or unreadable
  }

  return { original, modified };
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  prunable: boolean;
  hasChanges: boolean;
  ahead: number;
  behind: number;
  baseBranch: string;
}

interface RawWorktree {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
  prunable: boolean;
}

const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export const REPO_WORKTREES_ROOT = resolve(config.dataPath, "repo-worktrees");

function isValidBranchName(branch: string): boolean {
  return BRANCH_NAME_RE.test(branch) && !branch.includes("..") && !branch.endsWith(".lock") && !branch.endsWith("/");
}

async function rawWorktrees(repoPath: string): Promise<RawWorktree[]> {
  const { output, exitCode } = await executeSpawn("git", ["worktree", "list", "--porcelain"], repoPath, 10000);
  if (exitCode !== 0) return [];

  return output
    .split(/\n\s*\n/)
    .map((block) => {
      const entry: RawWorktree = { path: "", head: "", branch: "", bare: false, prunable: false };
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) entry.path = resolve(line.slice(9).trim());
        else if (line.startsWith("HEAD ")) entry.head = line.slice(5).trim();
        else if (line.startsWith("branch ")) entry.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
        else if (line === "bare") entry.bare = true;
        else if (line.startsWith("prunable")) entry.prunable = true;
      }
      return entry;
    })
    .filter((entry) => entry.path && !entry.bare);
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  const head = await executeSpawn("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repoPath, 5000).catch(() => null);
  if (head?.exitCode === 0) {
    const name = head.output.trim().replace(/^origin\//, "");
    if (name) return name;
  }
  for (const candidate of ["main", "master"]) {
    const result = await executeSpawn("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], repoPath, 5000).catch(() => null);
    if (result?.exitCode === 0) return candidate;
  }
  return "main";
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const entries = await rawWorktrees(repoPath);
  const baseBranch = await getDefaultBranch(repoPath);
  const mainPath = resolve(repoPath);
  const worktrees: WorktreeInfo[] = [];

  for (const entry of entries) {
    const isMain = entry.path === mainPath;

    let hasChanges = false;
    if (!entry.prunable) {
      try {
        const status = await executeSpawn("git", ["status", "--porcelain"], entry.path, 10000);
        hasChanges = status.output.trim().length > 0;
      } catch { /* worktree inacessível */ }
    }

    let ahead = 0;
    let behind = 0;
    if (!entry.prunable && entry.branch && entry.branch !== baseBranch) {
      const counts = await executeSpawn(
        "git",
        ["rev-list", "--left-right", "--count", `${baseBranch}...${entry.branch}`],
        repoPath,
        10000,
      ).catch(() => null);
      if (counts?.exitCode === 0) {
        const [left, right] = counts.output.trim().split(/\s+/).map(Number);
        behind = left || 0;
        ahead = right || 0;
      }
    }

    worktrees.push({
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      isMain,
      prunable: entry.prunable,
      hasChanges,
      ahead,
      behind,
      baseBranch,
    });
  }

  return worktrees;
}

export async function resolveWorktree(repoPath: string, worktreePath: string): Promise<{ path: string; branch: string } | null> {
  const target = resolve(worktreePath);
  if (target === resolve(repoPath)) return null;
  const entries = await rawWorktrees(repoPath);
  const found = entries.find((entry) => entry.path === target);
  return found ? { path: found.path, branch: found.branch } : null;
}

export function repoWorktreeDestPath(projectName: string, repoName: string, branch: string): string {
  const repoDir = repoName === "." ? "root" : repoName;
  return resolve(REPO_WORKTREES_ROOT, projectName, repoDir, slugify(branch));
}

export async function createRepoWorktree(
  projectName: string,
  repoName: string,
  repoPath: string,
  branch: string,
  baseBranch?: string,
): Promise<WorktreeInfo> {
  if (!isValidBranchName(branch)) {
    throw new Error("Nome de branch inválido.");
  }
  if (baseBranch && !isValidBranchName(baseBranch)) {
    throw new Error("Nome de branch base inválido.");
  }

  const base = baseBranch || (await getDefaultBranch(repoPath));
  const destPath = repoWorktreeDestPath(projectName, repoName, branch);
  if (existsSync(destPath)) {
    throw new Error(`Já existe um worktree em "${destPath}".`);
  }

  mkdirSync(dirname(destPath), { recursive: true });
  await ensureWorktree(repoPath, base, branch, destPath);

  const created = (await listWorktrees(repoPath)).find((w) => w.path === destPath);
  if (!created) throw new Error("Worktree criado, mas não encontrado na listagem.");
  return created;
}

export async function deleteRepoWorktree(repoPath: string, worktreePath: string, deleteBranch: boolean): Promise<boolean> {
  const worktree = await resolveWorktree(repoPath, worktreePath);
  if (!worktree) return false;
  await removeWorktree(repoPath, worktree.path, deleteBranch && worktree.branch ? worktree.branch : null);
  return true;
}

export async function mergeWorktreeIntoBase(
  repoPath: string,
  worktreePath: string,
  options: { push: boolean; remove: boolean },
): Promise<string> {
  const worktrees = await listWorktrees(repoPath);
  const worktree = worktrees.find((w) => w.path === resolve(worktreePath) && !w.isMain);
  if (!worktree) throw new Error("Worktree não encontrado.");
  if (!worktree.branch) throw new Error("Worktree está em detached HEAD, não é possível fazer merge.");
  if (worktree.hasChanges) {
    throw new Error("O worktree tem alterações não commitadas. Faça commit (ou stash) antes do merge.");
  }

  const base = worktree.baseBranch;
  const mainStatus = await executeSpawn("git", ["status", "--porcelain"], repoPath, 10000);
  if (mainStatus.output.trim()) {
    throw new Error(`O repositório principal tem alterações não commitadas. Resolva-as antes de mergear em "${base}".`);
  }

  const outputs: string[] = [];
  const current = (await executeSpawn("git", ["branch", "--show-current"], repoPath, 5000)).output.trim();
  if (current !== base) {
    const switched = await executeSpawn("git", ["switch", base], repoPath, 15000);
    if (switched.exitCode !== 0) {
      throw new Error(`Não foi possível mudar para "${base}": ${switched.output}`);
    }
  }

  const pull = await executeSpawn("git", ["pull", "--ff-only"], repoPath, 30000).catch(() => null);
  if (pull?.exitCode === 0 && pull.output.trim()) outputs.push(pull.output.trim());

  const merge = await executeSpawn("git", ["merge", "--no-ff", "-m", `Merge branch '${worktree.branch}'`, worktree.branch], repoPath, 30000);
  if (merge.exitCode !== 0) {
    await executeSpawn("git", ["merge", "--abort"], repoPath, 15000).catch(() => null);
    throw new Error(`Merge de "${worktree.branch}" em "${base}" falhou: ${merge.output}`);
  }
  outputs.push(merge.output.trim());

  if (options.push) {
    const push = await executeSpawn("git", ["push"], repoPath, 30000);
    if (push.exitCode !== 0) {
      throw new Error(`Merge concluído, mas o push falhou: ${push.output}`);
    }
    if (push.output.trim()) outputs.push(push.output.trim());
  }

  if (options.remove) {
    await removeWorktree(repoPath, worktree.path, worktree.branch);
    outputs.push(`Worktree removido e branch "${worktree.branch}" apagado.`);
  }

  return outputs.filter(Boolean).join("\n");
}

export function resolveRepoPath(projectPath: string, repoName: string): string | null {
  if (!REPO_NAME_RE.test(repoName) && repoName !== ".") return null;

  if (repoName === ".") return projectPath;

  const resolved = resolve(projectPath, repoName);
  if (!resolved.startsWith(projectPath + sep)) return null;

  if (!isGitRepo(resolved)) return null;

  return resolved;
}
