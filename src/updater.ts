import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOTIFIED_FILE = resolve(INSTALL_DIR, ".update-notified");
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000;

export interface UpdateInfo {
  available: boolean;
  currentCommit: string;
  currentDate: string;
  remoteCommit: string;
  commitCount: number;
  commits: string[];
}

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: cwd ?? INSTALL_DIR, timeout: UPDATE_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  await run("git", ["fetch", "origin"]);

  const currentCommit = await run("git", ["rev-parse", "--short", "HEAD"]);
  const currentDate = await run("git", ["log", "-1", "--format=%ci", "HEAD"]);
  const remoteCommitFull = await run("git", ["rev-parse", "origin/main"]);
  const localCommitFull = await run("git", ["rev-parse", "HEAD"]);

  if (remoteCommitFull === localCommitFull) {
    return {
      available: false,
      currentCommit,
      currentDate,
      remoteCommit: remoteCommitFull.slice(0, 7),
      commitCount: 0,
      commits: [],
    };
  }

  const countStr = await run("git", ["rev-list", "--count", "HEAD..origin/main"]);
  const commitCount = parseInt(countStr, 10) || 0;

  const logOutput = await run("git", ["log", "--oneline", "-5", "HEAD..origin/main"]);
  const commits = logOutput.split("\n").filter(Boolean);

  return {
    available: true,
    currentCommit,
    currentDate,
    remoteCommit: remoteCommitFull.slice(0, 7),
    commitCount,
    commits,
  };
}

export function getNotifiedCommit(): string | null {
  try {
    return readFileSync(NOTIFIED_FILE, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function setNotifiedCommit(commit: string): void {
  writeFileSync(NOTIFIED_FILE, commit, "utf-8");
}

export function clearNotifiedCommit(): void {
  try {
    writeFileSync(NOTIFIED_FILE, "", "utf-8");
  } catch {
    // non-critical
  }
}

export async function performUpdate(): Promise<{ success: boolean; output: string }> {
  const steps: string[] = [];

  try {
    steps.push("git pull...");
    const pullOutput = await run("git", ["pull", "--ff-only", "origin", "main"]);
    steps.push(pullOutput);

    steps.push("npm ci...");
    await run("npm", ["ci"], INSTALL_DIR);
    steps.push("dependencies installed");

    steps.push("npm ci (dashboard)...");
    await run("npm", ["ci"], resolve(INSTALL_DIR, "dashboard"));
    steps.push("dashboard dependencies installed");

    steps.push("npm run build:all...");
    await run("npm", ["run", "build:all"], INSTALL_DIR);
    steps.push("build complete");

    clearNotifiedCommit();

    return { success: true, output: steps.join("\n") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push(`FAILED: ${message}`);
    return { success: false, output: steps.join("\n") };
  }
}

export function restartService(): void {
  const child = execFile("sudo", ["systemctl", "restart", "claudemar"], {
    timeout: 10_000,
  });
  child.unref();
}
