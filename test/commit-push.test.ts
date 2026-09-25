import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { commitMessageGenerator, runCommitPush } from "../src/commit-push.js";
import { defaultLlmProfiles } from "../src/providers/llm.js";

const root = resolve(import.meta.dirname, "../../.output/commit-push/tests");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture() {
  await mkdir(root, { recursive: true });
  const cwd = await mkdtemp(`${root}/repo-`);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "init", "--bare", `${cwd}/remote.git`);
  await writeFile(`${cwd}/.gitignore`, "remote.git/\n");
  git(cwd, "remote", "add", "origin", `${cwd}/remote.git`);
  await writeFile(`${cwd}/file.txt`, "hello\n");
  return cwd;
}
const opts = (cwd: string) => ({ cwd, signal: new AbortController().signal, progress: () => {}, generate: async () => ({ message: "feat: add content $(touch never-execute)", tokens: 5 }) });

test("commits and pushes once, and retry with no changes skips generation", async () => {
  const cwd = await fixture();
  let calls = 0;
  const options = { ...opts(cwd), generate: async () => { calls++; return opts(cwd).generate(); } };
  assert.equal(await runCommitPush(options), 5);
  assert.equal(git(cwd, "log", "-1", "--format=%B"), "feat: add content $(touch never-execute)");
  assert.equal(git(`${cwd}/remote.git`, "rev-parse", "refs/heads/main"), git(cwd, "rev-parse", "HEAD"));
  assert.equal(git(cwd, "status", "--porcelain"), "");
  await runCommitPush(options);
  assert.equal(calls, 1);
});

test("API failure leaves staged changes and does not commit or push", async () => {
  const cwd = await fixture();
  await assert.rejects(runCommitPush({ ...opts(cwd), generate: async () => { throw new Error("API timeout"); } }), /API timeout/);
  assert.throws(() => git(cwd, "rev-parse", "HEAD"));
  assert.match(git(cwd, "diff", "--cached", "--name-only"), /file.txt/);
});

test("preserves hooks and reports their failure without pushing", async () => {
  const cwd = await fixture();
  await writeFile(`${cwd}/.git/hooks/pre-commit`, "#!/bin/sh\necho hook-failed >&2\nexit 1\n", { mode: 0o755 });
  await assert.rejects(runCommitPush(opts(cwd)), /hook-failed/);
  assert.throws(() => git(`${cwd}/remote.git`, "rev-parse", "refs/heads/main"));
});

test("rejects concurrent jobs and changed index during message generation", async () => {
  const cwd = await fixture();
  await assert.rejects(runCommitPush({ ...opts(cwd), generate: async () => {
    await assert.rejects(runCommitPush(opts(cwd)), /andamento/);
    await writeFile(`${cwd}/another.txt`, "new");
    git(cwd, "add", "another.txt");
    return opts(cwd).generate();
  } }), /mudaram durante/);
  assert.throws(() => git(cwd, "rev-parse", "HEAD"));
});

test("cancellation prevents commit and releases worktree lock", async () => {
  const cwd = await fixture();
  const controller = new AbortController();
  await assert.rejects(runCommitPush({ ...opts(cwd), signal: controller.signal, generate: async () => { controller.abort(); return opts(cwd).generate(); } }), /abort/i);
  await runCommitPush(opts(cwd));
});

test("direct API uses exactly one message request, fixed z.ai model and disabled thinking", async (t) => {
  let count = 0;
  const server = createServer(async (req, res) => {
    count++;
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    assert.equal(req.url, "/v1/messages");
    assert.equal(body.model, "glm-5.3-flash");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.tools, undefined);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ content: [{ type: "text", text: "fix: correct login" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  const profile = { ...defaultLlmProfiles().find((p) => p.id === "zai")!, baseUrl: `http://127.0.0.1:${address.port}`, extraEnv: "ANTHROPIC_AUTH_TOKEN=test" };
  const result = await commitMessageGenerator(profile)("diff", new AbortController().signal);
  assert.equal(result.message, "fix: correct login");
  assert.equal(result.tokens, 15);
  assert.equal(count, 1);
});

test("push failure can be retried without generating another commit", async () => {
  const cwd = await fixture();
  git(cwd, "remote", "set-url", "--push", "origin", `${cwd}/missing.git`);
  await assert.rejects(runCommitPush(opts(cwd)), /Enviando para origin.*git push/s);
  const head = git(cwd, "rev-parse", "HEAD");
  git(cwd, "remote", "set-url", "--push", "origin", `${cwd}/remote.git`);
  await runCommitPush({ ...opts(cwd), generate: async () => { throw new Error("Must not regenerate"); } });
  assert.equal(git(`${cwd}/remote.git`, "rev-parse", "refs/heads/main"), head);
});

test("worktree commits stay on the selected branch", async () => {
  const cwd = await fixture();
  await runCommitPush(opts(cwd));
  const main = git(cwd, "rev-parse", "HEAD");
  const worktree = `${cwd}/remote.git/worktree`;
  git(cwd, "worktree", "add", "-b", "feature", worktree);
  await writeFile(`${worktree}/file.txt`, "feature change\n");
  await runCommitPush(opts(worktree));
  assert.equal(git(cwd, "rev-parse", "HEAD"), main);
  assert.equal(git(`${cwd}/remote.git`, "rev-parse", "refs/heads/feature"), git(worktree, "rev-parse", "HEAD"));
});

test("abort during a hook stops Git before releasing the job lock", async () => {
  const cwd = await fixture();
  await writeFile(`${cwd}/.git/hooks/pre-commit`, "#!/bin/sh\nsleep 60\n", { mode: 0o755 });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await assert.rejects(runCommitPush({ ...opts(cwd), signal: controller.signal, progress: (text) => {
    if (text.includes("Criando commit e executando hooks…")) timer = setTimeout(() => controller.abort(), 100);
  } }), /cancelado/);
  clearTimeout(timer);
  assert.throws(() => git(cwd, "rev-parse", "HEAD"));
});

test("provider errors are returned immediately without automatic retries", async (t) => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "overloaded_error", message: "Unavailable" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  const profile = { ...defaultLlmProfiles().find((p) => p.id === "zai")!, baseUrl: `http://127.0.0.1:${address.port}`, extraEnv: "ANTHROPIC_AUTH_TOKEN=test" };
  await assert.rejects(commitMessageGenerator(profile)("diff", new AbortController().signal), /503/);
  assert.equal(calls, 1);
});

test("commit execution uses the direct session and settles correctly on cancellation", async () => {
  process.env.CLAUDEMAR_DATA = resolve(root, "session-data");
  process.env.BRAIN_ROOT = resolve(root, "session-data/brain");
  const { createAgentSession } = await import("../src/runtime/create-session.js");
  const { CommitPushSession } = await import("../src/runtime/commit-push-session.js");
  const session = createAgentSession({ taskMode: "commit-push", profile: defaultLlmProfiles().find((p) => p.id === "zai")!, cwd: await fixture(), target: { targetType: "project", targetName: "__commitpush:test" }, model: "glm-5.3-flash" });
  assert.ok(session instanceof CommitPushSession);
  await session.interrupt();
  session.sendUserMessage("commit");
  const result = await session.waitForResult();
  assert.equal(result.isError, true);
  assert.equal(session.isAlive(), false);
  assert.equal(result.sessionId, "");
});
