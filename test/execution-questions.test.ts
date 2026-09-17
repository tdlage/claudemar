import assert from "node:assert/strict";
import { SessionQuestions } from "../src/runtime/questions.js";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";
import type { ExecutionInfo, StartExecutionOpts } from "../src/execution-manager.js";
import type { AgentSession } from "../src/runtime/types.js";
import type { AgentResult, PendingQuestion } from "../src/providers/types.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/codex-questions/manager-data");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
process.env.QDRANT_URL = "";
const { ExecutionManager } = await import("../src/execution-manager.js");
const { sessionNamesManager } = await import("../src/session-names-manager.js");
const { getPool, closePool } = await import("../src/database.js");

interface Entry {
  info: ExecutionInfo;
  opts: StartExecutionOpts;
  session: AgentSession;
  sessionKey: string;
  detach?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  timeoutDeadline?: number;
}
interface Internals {
  active: Map<string, Entry>;
  wireSession(entry: Entry): void;
  handleResult(entry: Entry, result: AgentResult): void;
}

function setup() {
  const manager = new ExecutionManager();
  const internals = manager as unknown as Internals;
  const messages: unknown[] = [];
  const session = new EventEmitter() as AgentSession;
  const questions = new SessionQuestions((q) => session.emit("question", q), (id) => session.emit("questionResolved", id));
  session.sendUserMessage = (text) => { throw new Error(`Não deve criar outro turno: ${text}`); };
  session.respondQuestion = (id, text, answers) => {
    const accepted = questions.answer(id, text, answers);
    if (accepted) messages.push(text);
    return accepted;
  };
  const info: ExecutionInfo = {
    id: "exec-1", source: "web", targetType: "project", targetName: "GED", runtime: "codex", modelSelection: "codex-profile::model",
    prompt: "Ajustar acessos", cwd: process.env.CLAUDEMAR_DATA!, status: "running", startedAt: new Date(), completedAt: null,
    output: "", result: null, error: null, pendingQuestion: null, planMode: false, streamOffset: 0,
  };
  const opts: StartExecutionOpts = { source: "web", targetType: "project", targetName: "GED", cwd: info.cwd, prompt: info.prompt, rawPrompt: "Original", noResume: true, username: "admin", effort: "high" };
  const entry = { info, opts, session, sessionKey: "project:GED:admin" };
  internals.active.set(info.id, entry);
  internals.wireSession(entry);
  const pending: PendingQuestion = { toolUseId: "q-1", questions: [{ header: "Acessos", question: "Quais acessos?", options: [{ label: "Preservar", description: "" }], multiSelect: false }] };
  void questions.request(pending);
  return { manager, internals, entry, messages, pending };
}

test("a pergunta ao vivo fica disponível e a resposta entra uma única vez na sessão ativa", () => {
  const { manager, entry, messages, pending } = setup();
  assert.deepEqual(manager.getPendingQuestion(entry.info.id), pending);
  assert.equal(manager.getAllPendingQuestions().length, 1);
  assert.equal(manager.submitAnswer(entry.info.id, "Preservar", "stale-question"), null);
  assert.equal(manager.submitAnswer(entry.info.id, "  ", "q-1"), null);
  assert.equal(manager.submitAnswer(entry.info.id, "Preservar", "q-1"), entry.info.id);
  assert.equal(manager.submitAnswer(entry.info.id, "Preservar", "q-1"), null);
  assert.deepEqual(messages, ["Preservar"]);
  assert.equal(manager.getAllPendingQuestions().length, 0);
});

test("a pergunta permanece após conclusão e a resposta retoma a sessão com o modelo original", async (t) => {
  t.mock.method(getPool(), "execute", async () => [{ affectedRows: 1 }, []]);
  t.mock.method(sessionNamesManager, "getName", () => "Teste");
  t.after(() => closePool());
  const { manager, internals, entry, pending } = setup();
  internals.handleResult(entry, { output: "Aguardando resposta", sessionId: "original-session", costUsd: 0, totalTokens: 10, durationMs: 1, isError: false, errorMessages: [], permissionDenials: [] });
  assert.equal(manager.isExecutionActive(entry.info.id), false);
  assert.deepEqual(manager.getPendingQuestion(entry.info.id), pending);
  const start = t.mock.method(manager, "startExecution", () => "exec-2");
  manager.beginDrain();
  assert.equal(manager.submitAnswer(entry.info.id, "Preservar", "q-1"), "exec-2");
  assert.deepEqual(start.mock.calls[0].arguments[0], {
    ...entry.opts, model: "codex-profile::model", prompt: "Preservar", rawPrompt: "Preservar", blocks: undefined,
    resumeSessionId: "original-session", noResume: false, continueDuringDrain: true,
  });
  assert.equal(manager.getAllPendingQuestions().length, 0);
});

test("falha ao iniciar a continuação não descarta a pergunta", (t) => {
  const { manager, internals, entry, pending } = setup();
  internals.active.delete(entry.info.id);
  entry.info.result = { sessionId: "original-session" } as AgentResult;
  t.mock.method(manager, "startExecution", () => { throw new Error("Falha ao iniciar"); });
  assert.throws(() => manager.submitAnswer(entry.info.id, "Preservar", "q-1"), /Falha ao iniciar/);
  assert.deepEqual(manager.getPendingQuestion(entry.info.id), pending);
});

test("Claude continua publicando perguntas a partir de AskUserQuestion", async (t) => {
  t.mock.method(getPool(), "execute", async () => [{ affectedRows: 1 }, []]);
  t.mock.method(sessionNamesManager, "getName", () => "Teste");
  t.after(() => closePool());
  const { manager, internals, entry, pending } = setup();
  manager.submitAnswer(entry.info.id, "Resposta anterior", "q-1");
  entry.info.runtime = "claude";
  internals.handleResult(entry, {
    output: "Escolha o acesso", sessionId: "claude-session", costUsd: 0, totalTokens: 10, durationMs: 1, isError: false, errorMessages: [],
    permissionDenials: [{ tool_name: "AskUserQuestion", tool_use_id: "claude-question", tool_input: { questions: pending.questions } }],
  });
  assert.deepEqual(manager.getPendingQuestion(entry.info.id), { toolUseId: "claude-question", questions: pending.questions });
  assert.equal(manager.getAllPendingQuestions().length, 1);
});

test("o limite de execução pausa durante a pergunta e retoma com o tempo restante", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { manager, entry, pending } = setup();
  const timed = entry as Entry;
  const interrupt = t.mock.fn(async () => {});
  entry.session.interrupt = interrupt;
  timed.timeoutDeadline = Date.now() + 100;
  timed.timer = setTimeout(interrupt, 100);
  t.mock.timers.tick(20);
  entry.session.emit("question", pending);
  t.mock.timers.tick(1000);
  assert.equal(interrupt.mock.callCount(), 0);
  assert.equal(manager.submitAnswer(entry.info.id, "Sim", "q-1"), entry.info.id);
  t.mock.timers.tick(79);
  assert.equal(interrupt.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(interrupt.mock.callCount(), 1);
});
