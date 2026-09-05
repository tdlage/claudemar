import { strict as assert } from "node:assert";
import { test, after } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const output = resolve(import.meta.dirname, "../.localfiles");
mkdirSync(output, { recursive: true });
const root = mkdtempSync(resolve(output, "repo-visibility-"));
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = root;
process.env.BRAIN_ROOT = resolve(root, "brain");
const { discoverRepos, hiddenReposPath, setRepoVisibility, cloneRepo, resolveRepoPath } = await import("../src/repositories.js");
after(() => rmSync(root, { recursive: true, force: true }));

function project(name: string) {
  const path = resolve(root, "projects", name);
  mkdirSync(resolve(path, "repo"), { recursive: true });
  execFileSync("git", ["init", "--quiet", resolve(path, "repo")]);
  writeFileSync(resolve(path, "repo", "untracked.txt"), "preserve me");
  return path;
}

test("move, rediscover after reload and restore preserve Git and untracked files", async () => {
  const path = project("persist");
  assert.equal((await discoverRepos(path)).length, 1);
  setRepoVisibility(path, "repo", false);
  assert.equal(existsSync(resolve(path, "repo")), false);
  assert.equal(resolveRepoPath(path, "repo"), null);
  assert.deepEqual(await discoverRepos(path), []);
  const reloaded = await import("../src/repositories.js?reload");
  const repos = await reloaded.discoverRepos(path, true);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].hidden, true);
  assert.equal(readFileSync(resolve(hiddenReposPath(path), "repo", "untracked.txt"), "utf8"), "preserve me");
  await assert.rejects(cloneRepo(path, "https://example.com/repo.git"), /oculto/);
  setRepoVisibility(path, "repo", false);
  setRepoVisibility(path, "repo", true);
  setRepoVisibility(path, "repo", true);
  assert.equal(readFileSync(resolve(path, "repo", "untracked.txt"), "utf8"), "preserve me");
  assert.equal((await discoverRepos(path)).length, 1);
});

test("rejects traversal, root, symlinks, worktrees and destination conflicts without losing data", () => {
  const path = project("guards");
  for (const name of [".", "..", "../repo", "/repo"]) assert.throws(() => setRepoVisibility(path, name, false));
  symlinkSync(resolve(path, "repo"), resolve(path, "link"));
  assert.throws(() => setRepoVisibility(path, "link", false));
  mkdirSync(resolve(path, "repo", ".git", "worktrees", "linked"), { recursive: true });
  assert.throws(() => setRepoVisibility(path, "repo", false), /worktrees/);
  rmSync(resolve(path, "repo", ".git", "worktrees"), { recursive: true });
  setRepoVisibility(path, "repo", false);
  mkdirSync(resolve(path, "repo"));
  assert.throws(() => setRepoVisibility(path, "repo", true), /destino/);
  assert.equal(readFileSync(resolve(hiddenReposPath(path), "repo", "untracked.txt"), "utf8"), "preserve me");
});

test("projects keep independent repository selections", async () => {
  const first = project("first");
  const second = project("second");
  setRepoVisibility(first, "repo", false);
  assert.equal((await discoverRepos(first)).length, 0);
  assert.equal((await discoverRepos(second)).length, 1);
});
