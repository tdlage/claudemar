import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/claude-forked-command");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
process.env.QDRANT_URL = "";
const { ClaudeSession } = await import("../src/claude/session.js");
const { formatToolUse } = await import("../src/providers/format.js");

interface Internals {
  turnPrompts: string[];
  activeTasks: Map<string, unknown>;
  handleSystem(message: Record<string, unknown>): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

function fakeSession(prompt: string) {
  const session = Object.create(ClaudeSession.prototype) as Internals;
  Object.assign(session, { turnPrompts: [prompt], activeTasks: new Map(), taskFailures: new Map() });
  const tools: unknown[][] = [];
  const tasks: Record<string, unknown>[] = [];
  session.on("toolUse", (...args) => tools.push(args));
  session.on("task", (payload) => tasks.push(payload as Record<string, unknown>));
  return { session, tools, tasks };
}

const forkedStart = (description: string) => ({
  type: "system",
  subtype: "task_started",
  task_id: "fork-1",
  task_type: "local_agent",
  description,
  skip_transcript: true,
});

test("forked slash command sent by the user becomes visible activity until its notification", () => {
  const { session, tools, tasks } = fakeSession("/code-review e inclua a migração do admin");
  session.handleSystem(forkedStart("/code-review"));
  assert.deepEqual(tools, [["Skill", { skill: "code-review" }]]);
  assert.equal(tasks[0]?.phase, "started");
  assert.equal(tasks[0]?.description, "/code-review");
  assert.equal(session.activeTasks.has("fork-1"), true);

  session.handleSystem({ type: "system", subtype: "task_notification", task_id: "fork-1", status: "completed", summary: "ok" });
  assert.equal(tasks[1]?.phase, "done");
  assert.equal(tasks[1]?.status, "completed");
  assert.equal(session.activeTasks.size, 0);
});

test("ambient skip_transcript tasks that are not the user's command stay hidden", () => {
  const { session, tools, tasks } = fakeSession("/code-review");
  session.handleSystem(forkedStart("/code-reviewer"));
  session.handleSystem({ ...forkedStart("session memory"), task_id: "fork-2" });
  session.handleSystem({ ...forkedStart("/code-review"), task_id: "fork-3", task_type: "local_bash" });
  assert.equal(tools.length, 0);
  assert.equal(tasks.length, 0);
  assert.equal(session.activeTasks.size, 0);
});

test("Skill tool lines show the slash command", () => {
  assert.match(formatToolUse("Skill", { skill: "code-review" }), /Skill.*\/code-review/);
});
