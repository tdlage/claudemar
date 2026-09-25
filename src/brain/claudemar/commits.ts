import { config } from "../../config.js";
import { executeSpawn } from "../../executor.js";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { dayKeyInTz } from "../text.js";
import type { CanonicalEvent } from "../types.js";
import { clipMiddle } from "./execution-events.js";
import { CLAUDEMAR_ACCOUNT } from "./managed.js";
import { targetHandle, targetKey, targetLabel, targetRoot, type ClaudemarTarget } from "./targets.js";

export interface TargetRepo {
  target: ClaudemarTarget;
  name: string;
  path: string;
  remoteUrl: string;
}

export interface CommitRecord {
  hash: string;
  author: string;
  email: string;
  authoredAt: string;
  committedAt: string;
  message: string;
  files: string[];
}

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const BODY_END = "\x1d";
const LOG_FORMAT = `--format=${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%cI${FIELD_SEP}%B${BODY_END}`;
const GIT_TIMEOUT_MS = 60_000;
const MAX_FILES_LISTED = 40;

const REPO_CACHE_TTL_MS = 60_000;
const repoCache = new Map<string, { repos: TargetRepo[]; at: number }>();

async function remoteOf(path: string): Promise<string> {
  const { output, exitCode } = await executeSpawn("git", ["config", "--get", "remote.origin.url"], path, 5000).catch(() => ({
    output: "",
    exitCode: 1,
  }));
  return exitCode === 0 ? output.trim().replace(/\/\/[^/@\s]+@/, "//") : "";
}

/** Descobre repositórios sem "git status", que disputaria o index.lock com agentes commitando no mesmo repo. */
export async function targetRepos(target: ClaudemarTarget): Promise<TargetRepo[]> {
  const key = targetKey(target);
  const cached = repoCache.get(key);
  if (cached && Date.now() - cached.at < REPO_CACHE_TTL_MS) return cached.repos;
  const root = targetRoot(target);
  const candidates: { name: string; path: string }[] = [];
  if (existsSync(resolve(root, ".git"))) candidates.push({ name: ".", path: root });
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(resolve(root, entry.name, ".git"))) {
      candidates.push({ name: entry.name, path: resolve(root, entry.name) });
    }
  }
  const repos = await Promise.all(
    candidates.map(async (c) => ({ target, name: c.name, path: c.path, remoteUrl: await remoteOf(c.path) })),
  );
  repoCache.set(key, { repos, at: Date.now() });
  return repos;
}

function formatFileLine(line: string): string {
  const [status, ...paths] = line.split("\t");
  return paths.length > 1 ? `${status[0]} ${paths[0]} → ${paths[1]}` : `${status[0]} ${paths[0] ?? ""}`.trim();
}

export function parseGitLog(output: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  for (const chunk of output.split(RECORD_SEP)) {
    const end = chunk.indexOf(BODY_END);
    if (end < 0) continue;
    const fields = chunk.slice(0, end).split(FIELD_SEP);
    if (fields.length < 6 || !/^[0-9a-f]{40}$/.test(fields[0])) continue;
    const files = chunk
      .slice(end + 1)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[ACDMRTUX]\d*\t/.test(l))
      .map(formatFileLine);
    commits.push({
      hash: fields[0],
      author: fields[1],
      email: fields[2],
      authoredAt: new Date(fields[3]).toISOString(),
      committedAt: new Date(fields[4]).toISOString(),
      message: fields.slice(5).join(FIELD_SEP).trim(),
      files,
    });
  }
  return commits;
}

export async function readCommits(repo: TargetRepo, since: string, until: string | null, maxCount: number): Promise<CommitRecord[]> {
  const args = ["log", "--branches", "--no-merges", `--since=${since}`, `--max-count=${maxCount}`, "--name-status", LOG_FORMAT];
  if (until) args.splice(3, 0, `--until=${until}`);
  const { output, exitCode } = await executeSpawn("git", args, repo.path, GIT_TIMEOUT_MS);
  if (exitCode !== 0) throw new Error(`git log falhou em ${repo.path}: ${output.slice(0, 300)}`);
  return parseGitLog(output);
}

export function commitThreadKey(repo: TargetRepo, day: string): string {
  return `cm:git:${targetKey(repo.target)}:${repo.name}:${day}`;
}

export function commitEvent(repo: TargetRepo, commit: CommitRecord): CanonicalEvent {
  const day = dayKeyInTz(new Date(commit.authoredAt), config.brainTz);
  const repoLabel = repo.name === "." ? "raiz" : repo.name;
  const files = commit.files.length > MAX_FILES_LISTED
    ? [...commit.files.slice(0, MAX_FILES_LISTED), `… e mais ${commit.files.length - MAX_FILES_LISTED}`]
    : commit.files;
  return {
    channel: "claudemar",
    subchannel: "direct",
    account: CLAUDEMAR_ACCOUNT,
    external_id: `cm:git:${targetKey(repo.target)}:${repo.name}:${commit.hash}`,
    thread_key: commitThreadKey(repo, day),
    occurred_at: commit.authoredAt,
    participants: [
      { name: targetLabel(repo.target), handle: targetHandle(repo.target), role: "agent" },
      { name: commit.author || "desconhecido", handle: `git:${commit.email || commit.author}`, role: "from" },
    ],
    subject: `${targetLabel(repo.target)} — commits no repositório ${repoLabel} (${day})`,
    body_text: clipMiddle(
      `Commit ${commit.hash.slice(0, 10)} no repositório ${repoLabel} de ${targetLabel(repo.target)}, por ${commit.author} em ${commit.authoredAt}.\n\n${commit.message}${files.length > 0 ? `\n\nArquivos (${commit.files.length}):\n${files.join("\n")}` : ""}`,
    ),
    attachments: [],
    raw_ref: `git:${commit.hash}`,
  };
}

export async function recentCommits(target: ClaudemarTarget, limit: number): Promise<(CommitRecord & { repo: string })[]> {
  const all: (CommitRecord & { repo: string })[] = [];
  for (const repo of await targetRepos(target)) {
    const { output, exitCode } = await executeSpawn(
      "git",
      ["log", "--branches", "--no-merges", `--max-count=${limit}`, LOG_FORMAT],
      repo.path,
      GIT_TIMEOUT_MS,
    ).catch(() => ({ output: "", exitCode: 1 }));
    if (exitCode !== 0) continue;
    all.push(...parseGitLog(output).map((c) => ({ ...c, repo: repo.name === "." ? "raiz" : repo.name })));
  }
  return all.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt)).slice(0, limit);
}
