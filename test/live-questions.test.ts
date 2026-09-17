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
