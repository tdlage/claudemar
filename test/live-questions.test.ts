import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { SessionQuestions } from "../src/runtime/questions.js";
import type { PendingQuestion } from "../src/providers/types.js";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { defaultLlmProfiles } from "../src/providers/llm.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/codex-questions/live-data");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
process.env.QDRANT_URL = "";
const { BaseAgentSession } = await import("../src/runtime/base-session.js");
const { ClaudeSession } = await import("../src/claude/session.js");

const pending: PendingQuestion = { toolUseId: "q-1", questions: [{ header: "Acesso", question: "Preservar acessos?", options: [{ label: "Sim", description: "" }], multiSelect: false }] };

test("perguntas simultâneas aguardam e recebem somente suas próprias respostas", async () => {
  const events: string[] = [];
  const questions = new SessionQuestions((q) => events.push(q.toolUseId), (id) => events.push(`resolved:${id}`));
  const first = questions.request(pending);
  const second = questions.request({ ...pending, toolUseId: "q-2" });
  let completed = false;
  void first.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(events, ["q-1"]);
  assert.equal(questions.answer("q-2", "Outra resposta"), false);
  assert.equal(questions.answer("q-1", "Sim"), true);
  assert.deepEqual(await first, { "Preservar acessos?": "Sim" });
  assert.deepEqual(events, ["q-1", "resolved:q-1", "q-2"]);
  assert.equal(questions.answer("q-2", "Não"), true);
  assert.deepEqual(await second, { "Preservar acessos?": "Não" });
  assert.equal(questions.waiting, false);
});

test("respostas incompletas não liberam um grupo de perguntas", async () => {
  const questions = new SessionQuestions(() => {}, () => {});
  const next = { ...pending, questions: [...pending.questions, { ...pending.questions[0], question: "Qual perfil?" }] };
  const result = questions.request(next);
  assert.equal(questions.answer("q-1", "Sim"), false);
  assert.equal(questions.answer("q-1", "Sim", { "Preservar acessos?": "Sim" }), false);
  const answers = { "Preservar acessos?": "Sim", "Qual perfil?": "Administrador" };
  assert.equal(questions.answer("q-1", "texto", answers), true);
  assert.deepEqual(await result, answers);
});

test("cancelamento encerra a espera sem inventar resposta e remove a pergunta", async () => {
  const removed: string[] = [];
  const questions = new SessionQuestions(() => {}, (id) => removed.push(id));
  const abort = new AbortController();
  const result = questions.request(pending, abort.signal);
  const rejected = assert.rejects(result, /cancelada/);
  abort.abort();
  await rejected;
  assert.deepEqual(removed, ["q-1"]);
  assert.equal(questions.answer("q-1", "Sim"), false);
});

function claudeHarness() {
  const profile = defaultLlmProfiles().find((p) => p.runtime === "claude")!;
  const session = Reflect.construct(BaseAgentSession, [{ profile, cwd: process.env.CLAUDEMAR_DATA!, target: { targetType: "project", targetName: "GED" }, inactivityTimeoutMs: 10 }], ClaudeSession) as InstanceType<typeof ClaudeSession>;
  Object.assign(session, {
    bypass: true,
    currentPermissionMode: "bypassPermissions",
    handledQuestions: new Set<string>(),
    pendingTasksGraceMs: 10,
    pendingResult: { output: "Subagente trabalhando" },
    activeTasks: new Map([["task-1", { description: "Trabalho independente" }]]),
    taskFailures: new Map(),
    pendingTasksTimer: null,
  });
  const internals = session as unknown as { handlePermission: CanUseTool; startInactivityTimer(): void; startPendingTasksTimer(): void; clearInactivityTimer(): void; clearPendingTasksTimer(): void; activeTasks: Map<string, unknown>; pendingResult: unknown };
  return { session, internals };
}

test("Claude publica AskUserQuestion imediatamente e devolve updatedInput com as respostas no mesmo callback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { session, internals } = claudeHarness();
  t.after(() => { internals.clearInactivityTimer(); internals.clearPendingTasksTimer(); });
  const shown: PendingQuestion[] = [];
  session.on("question", (q) => shown.push(q));
  const signal = new AbortController().signal;
  const input = { questions: pending.questions };
  internals.startInactivityTimer();
  internals.startPendingTasksTimer();
  const response = internals.handlePermission("AskUserQuestion", input, { signal, toolUseID: "q-1", requestId: "req-1" });
  let completed = false;
  void response.then(() => { completed = true; });
  assert.deepEqual(shown, [pending]);
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(session.getLastResult(), null);
  assert.equal(internals.activeTasks.size, 1);
  assert.equal(session.respondQuestion("q-1", "Sim", { "Preservar acessos?": "Sim" }), true);
  assert.deepEqual(await response, { behavior: "allow", updatedInput: { ...input, answers: { "Preservar acessos?": "Sim" } } });
  assert.equal(internals.activeTasks.size, 1);
  assert.equal(session.respondQuestion("q-1", "Não"), false);
});

test("Claude cancela o callback de pergunta quando o SDK aborta a chamada", async (t) => {
  const { session, internals } = claudeHarness();
  t.after(() => { internals.clearInactivityTimer(); internals.clearPendingTasksTimer(); });
  const abort = new AbortController();
  const response = internals.handlePermission("AskUserQuestion", { questions: pending.questions }, { signal: abort.signal, toolUseID: "q-1", requestId: "req-1" });
  abort.abort();
  assert.deepEqual(await response, { behavior: "deny", message: "Pergunta cancelada.", interrupt: true });
  assert.equal(session.respondQuestion("q-1", "Sim"), false);
});

test("Claude task failures preserve description and expose provider error", () => {
  const { session, internals } = claudeHarness();
  internals.pendingResult = null;
  const events: unknown[] = [];
  session.on("task", (event) => events.push(event));
  const tasks = session as unknown as { handleTaskUpdated(message: unknown): void };
  tasks.handleTaskUpdated({ task_id: "task-1", patch: { status: "failed", error: "Authentication failed" } });
  assert.deepEqual(events, [{ phase: "updated", taskId: "task-1", description: "Trabalho independente", subagentType: undefined, status: "failed", error: "Authentication failed" }]);
});

test("Claude final task notification includes the original description", () => {
  const { session, internals } = claudeHarness();
  internals.pendingResult = null;
  const events: Array<{ description?: string; summary?: string }> = [];
  session.on("task", (event) => events.push(event));
  const tasks = session as unknown as { handleTaskNotification(message: unknown): void };
  tasks.handleTaskNotification({ task_id: "task-1", status: "failed", summary: "Worker failed" });
  assert.equal(events[0].description, "Trabalho independente");
  assert.equal(events[0].summary, "Worker failed");
});

function resultHarness() {
  const { session, internals } = claudeHarness();
  internals.pendingResult = null;
  internals.activeTasks.clear();
  Object.assign(session, { ingestResult: () => {}, emitUsage: async () => {} });
  return {
    session,
    methods: session as unknown as {
      handleResult(message: unknown): void;
      handleTaskStarted(message: unknown): void;
      handleTaskNotification(message: unknown): void;
      drainPendingResult(reason: string): void;
    },
  };
}
const successResult = { type: "result", subtype: "success", is_error: false, result: "", session_id: "session", permission_denials: [], duration_ms: 1 };

test("Claude respects is_error even when the SDK subtype is success", async () => {
  const { session, methods } = resultHarness();
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, is_error: true, result: "API overloaded", api_error_status: 529 });
  assert.equal((await result).isError, true);
  assert.deepEqual((await result).errorMessages, ["API overloaded"]);
  assert.equal((await result).output, "API overloaded");
});

test("Claude retains API status when the error has no text", async () => {
  const { session, methods } = resultHarness();
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, is_error: true, api_error_status: 401 });
  assert.equal((await result).isError, true);
  assert.match((await result).errorMessages[0], /HTTP 401/);
});

test("an empty Claude turn cannot silently complete successfully", async () => {
  const { session, methods } = resultHarness();
  const result = session.waitForResult();
  methods.handleResult(successResult);
  assert.equal((await result).isError, true);
  assert.match((await result).errorMessages[0], /sem retornar uma resposta/);
});

test("empty parent result waits for subagents and includes their failures", async () => {
  const { session, methods } = resultHarness();
  const result = session.waitForResult();
  methods.handleTaskStarted({ task_id: "worker", description: "Review" });
  methods.handleResult(successResult);
  assert.equal(session.getLastResult(), null);
  methods.handleTaskNotification({ task_id: "worker", status: "failed", summary: "Worker authentication failed" });
  assert.equal((await result).isError, true);
  assert.deepEqual((await result).errorMessages, ["Worker authentication failed"]);
});

test("stream failure while waiting for workers does not turn partial output into success", async () => {
  const { session, methods } = resultHarness();
  const result = session.waitForResult();
  methods.handleTaskStarted({ task_id: "worker", description: "Review" });
  methods.handleResult({ ...successResult, result: "Review in progress" });
  methods.drainPendingResult("SDK connection closed");
  assert.equal((await result).isError, true);
  assert.match((await result).errorMessages.join(" "), /SDK connection closed/);
});

test("a normal Claude answer still completes successfully", async () => {
  const { session, methods } = resultHarness();
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, result: "Documentos gerados." });
  assert.equal((await result).isError, false);
  assert.equal((await result).output, "Documentos gerados.");
});

test("a resumed session ignores an empty housekeeping result before the user turn", async () => {
  const { session, methods } = resultHarness();
  Object.assign(session, { userMessageId: "current-prompt" });
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, num_turns: 0, duration_ms: 37, queued_turn_count: 1 });
  assert.equal(session.getLastResult(), null);
  methods.handleResult({ ...successResult, result: "Revisão concluída", num_turns: 1, user_message_uuid: "current-prompt" });
  assert.equal((await result).isError, false);
  assert.equal((await result).output, "Revisão concluída");
});

test("results for old prompts cannot finish the current execution", async () => {
  const { session, methods } = resultHarness();
  Object.assign(session, { userMessageId: "current-prompt" });
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, result: "Resposta anterior", user_message_uuid: "old-prompt" });
  assert.equal(session.getLastResult(), null);
  methods.handleResult({ ...successResult, result: "Resposta atual", user_message_uuid: "last-batched", user_message_uuids: ["current-prompt", "last-batched"] });
  assert.equal((await result).output, "Resposta atual");
});

test("an empty result bound to the actual user prompt still reports failure", async () => {
  const { session, methods } = resultHarness();
  Object.assign(session, { userMessageId: "current-prompt" });
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, num_turns: 0, user_message_uuid: "current-prompt" });
  assert.equal((await result).isError, true);
});

test("an unbound API failure is not mistaken for housekeeping", async () => {
  const { session, methods } = resultHarness();
  Object.assign(session, { userMessageId: "current-prompt" });
  const result = session.waitForResult();
  methods.handleResult({ ...successResult, num_turns: 0, is_error: true, api_error_status: 429 });
  assert.equal((await result).isError, true);
  assert.match((await result).errorMessages[0], /429/);
});
