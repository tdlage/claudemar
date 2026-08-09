import { existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { executeSpawn } from "../executor.js";
import { brainRoot } from "./paths.js";

const COMMIT_MAX_FILES = 50;
const COMMIT_INTERVAL_MS = 5 * 60 * 1000;
const GIT_TIMEOUT_MS = 60_000;

let lock: Promise<unknown> = Promise.resolve();

export function brainWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

export function ensureBrainRepo(): void {
  if (!existsSync(resolve(brainRoot, ".git"))) {
    execFileSync("git", ["init"], { cwd: brainRoot, stdio: "ignore" });
  }
  execFileSync("git", ["config", "user.email", "brain@claudemar.local"], { cwd: brainRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Claudemar Brain"], { cwd: brainRoot, stdio: "ignore" });
}

let dirtyCount = 0;
let commitTimer: ReturnType<typeof setTimeout> | null = null;

async function doCommit(reason: string): Promise<void> {
  const add = await executeSpawn("git", ["add", "-A"], brainRoot, GIT_TIMEOUT_MS);
  if (add.exitCode !== 0) {
    console.error("[brain] git add falhou:", add.output.slice(0, 500));
    return;
  }
  dirtyCount = 0;
  if (commitTimer) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  const status = await executeSpawn("git", ["status", "--porcelain"], brainRoot, GIT_TIMEOUT_MS);
  if (status.exitCode !== 0 || status.output.trim() === "") return;
  const commit = await executeSpawn(
    "git",
    ["commit", "-m", `brain: ${reason} (${new Date().toISOString()})`],
    brainRoot,
    GIT_TIMEOUT_MS,
  );
  if (commit.exitCode !== 0) {
    console.error("[brain] git commit falhou:", commit.output.slice(0, 500));
  }
}

function scheduleCommit(): void {
  dirtyCount += 1;
  if (dirtyCount >= COMMIT_MAX_FILES) {
    void brainWriteLock(() => doCommit("batch"));
    return;
  }
  if (!commitTimer) {
    commitTimer = setTimeout(() => {
      commitTimer = null;
      void brainWriteLock(() => doCommit("interval"));
    }, COMMIT_INTERVAL_MS);
    commitTimer.unref();
  }
}

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  scheduleCommit();
}

export async function flushBrainGit(): Promise<void> {
  await brainWriteLock(() => doCommit("flush"));
}

export interface BrainGitVersion {
  sha: string;
  date: string;
  message: string;
}

export async function fileHistory(relPath: string, limit = 20): Promise<BrainGitVersion[]> {
  const result = await executeSpawn(
    "git",
    ["log", `--format=%H%x09%aI%x09%s`, "-n", String(limit), "--", relPath],
    brainRoot,
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

export async function fileAtCommit(relPath: string, sha: string): Promise<string | null> {
  if (!/^[0-9a-f]{6,40}$/i.test(sha)) return null;
  const result = await executeSpawn("git", ["show", `${sha}:${relPath}`], brainRoot, GIT_TIMEOUT_MS);
  return result.exitCode === 0 ? result.output : null;
}

export async function repoInfo(): Promise<{ head: string; dirty: number }> {
  const [head, status] = await Promise.all([
    executeSpawn("git", ["rev-parse", "--short", "HEAD"], brainRoot, GIT_TIMEOUT_MS).catch(() => null),
    executeSpawn("git", ["status", "--porcelain"], brainRoot, GIT_TIMEOUT_MS).catch(() => null),
  ]);
  return {
    head: head && head.exitCode === 0 ? head.output.trim() : "",
    dirty: status && status.exitCode === 0 ? status.output.split("\n").filter(Boolean).length : 0,
  };
}
