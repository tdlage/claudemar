import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { rm } from "node:fs/promises";
import { executeSpawn } from "./executor.js";

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
    ["checkout", "--", branch],
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
      const xy = line.slice(0, 2);
      const filePath = line.slice(3).trim();

      let status: string;
      if (xy === "??") status = "?";
      else if (xy.includes("D")) status = "D";
      else if (xy.includes("A")) status = "A";
      else if (xy.includes("R")) status = "R";
      else if (xy.includes("M") || xy.includes("m")) status = "M";
      else status = xy.trim() || "M";

      return { status, path: filePath };
    });
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

export function resolveRepoPath(projectPath: string, repoName: string): string | null {
  if (!REPO_NAME_RE.test(repoName) && repoName !== ".") return null;

  if (repoName === ".") return projectPath;

  const resolved = resolve(projectPath, repoName);
  if (!resolved.startsWith(projectPath + sep)) return null;

  if (!isGitRepo(resolved)) return null;

  return resolved;
}
