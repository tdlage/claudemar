import { existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { executeSpawn } from "../executor.js";
import { perScope, type BrainScope } from "./scope.js";

const COMMIT_MAX_FILES = 50;
const COMMIT_INTERVAL_MS = 5 * 60 * 1000;
const GIT_TIMEOUT_MS = 60_000;

interface RepoState {
  lock: Promise<unknown>;
  dirtyCount: number;
  commitTimer: ReturnType<typeof setTimeout> | null;
}

const repoState = perScope((): RepoState => ({ lock: Promise.resolve(), dirtyCount: 0, commitTimer: null }));

export function brainWriteLock<T>(scope: BrainScope, fn: () => Promise<T> | T): Promise<T> {
  const state = repoState(scope);
  const run = state.lock.then(fn, fn);
  state.lock = run.catch(() => {});
  return run;
}

export function ensureBrainRepo(scope: BrainScope): void {
  if (!existsSync(resolve(scope.root, ".git"))) {
    execFileSync("git", ["init"], { cwd: scope.root, stdio: "ignore" });
  }
  execFileSync("git", ["config", "user.email", "brain@claudemar.local"], { cwd: scope.root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Claudemar Brain"], { cwd: scope.root, stdio: "ignore" });
}

async function doCommit(scope: BrainScope, reason: string): Promise<void> {
  if (!existsSync(resolve(scope.root, ".git"))) return;
  const state = repoState(scope);
  const add = await executeSpawn("git", ["add", "-A"], scope.root, GIT_TIMEOUT_MS);
  if (add.exitCode !== 0) {
    console.error(`[brain:${scope.owner}] git add falhou:`, add.output.slice(0, 500));
    return;
  }
  state.dirtyCount = 0;
  if (state.commitTimer) {
    clearTimeout(state.commitTimer);
    state.commitTimer = null;
  }
  const status = await executeSpawn("git", ["status", "--porcelain"], scope.root, GIT_TIMEOUT_MS);
  if (status.exitCode !== 0 || status.output.trim() === "") return;
  const commit = await executeSpawn(
    "git",
    ["commit", "-m", `brain: ${reason} (${new Date().toISOString()})`],
    scope.root,
    GIT_TIMEOUT_MS,
  );
  if (commit.exitCode !== 0) {
    console.error(`[brain:${scope.owner}] git commit falhou:`, commit.output.slice(0, 500));
  }
}

function scheduleCommit(scope: BrainScope): void {
  const state = repoState(scope);
  state.dirtyCount += 1;
  if (state.dirtyCount >= COMMIT_MAX_FILES) {
    void brainWriteLock(scope, () => doCommit(scope, "batch"));
    return;
  }
  if (!state.commitTimer) {
    state.commitTimer = setTimeout(() => {
      state.commitTimer = null;
      void brainWriteLock(scope, () => doCommit(scope, "interval"));
    }, COMMIT_INTERVAL_MS);
    state.commitTimer.unref();
  }
}

export async function writeFileAtomic(scope: BrainScope, path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  scheduleCommit(scope);
}

export async function flushBrainGit(scope: BrainScope): Promise<void> {
  await brainWriteLock(scope, () => doCommit(scope, "flush"));
}

/** Para o commit periódico de um brain que vai ser apagado, sem gravar nada. */
export function cancelBrainGit(scope: BrainScope): void {
  const state = repoState(scope);
  if (state.commitTimer) {
    clearTimeout(state.commitTimer);
    state.commitTimer = null;
  }
  state.dirtyCount = 0;
}

export interface BrainGitVersion {
  sha: string;
  date: string;
  message: string;
}

export async function fileHistory(scope: BrainScope, relPath: string, limit = 20): Promise<BrainGitVersion[]> {
  const result = await executeSpawn(
    "git",
    ["log", `--format=%H%x09%aI%x09%s`, "-n", String(limit), "--", relPath],
    scope.root,
    GIT_TIMEOUT_MS,
  );
  if (result.exitCode !== 0) return [];
  return result.output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...rest] = line.split("\t");
      return { sha: sha ?? "", date: date ?? "", message: rest.join("\t") };
    })
    .filter((v) => v.sha);
}

export async function fileAtCommit(scope: BrainScope, relPath: string, sha: string): Promise<string | null> {
  if (!/^[0-9a-f]{6,40}$/i.test(sha)) return null;
  const result = await executeSpawn("git", ["show", `${sha}:${relPath}`], scope.root, GIT_TIMEOUT_MS);
  return result.exitCode === 0 ? result.output : null;
}

export async function repoInfo(scope: BrainScope): Promise<{ head: string; dirty: number }> {
  const [head, status] = await Promise.all([
    executeSpawn("git", ["rev-parse", "--short", "HEAD"], scope.root, GIT_TIMEOUT_MS).catch(() => null),
    executeSpawn("git", ["status", "--porcelain"], scope.root, GIT_TIMEOUT_MS).catch(() => null),
  ]);
  return {
    head: head && head.exitCode === 0 ? head.output.trim() : "",
    dirty: status && status.exitCode === 0 ? status.output.split("\n").filter(Boolean).length : 0,
  };
}
