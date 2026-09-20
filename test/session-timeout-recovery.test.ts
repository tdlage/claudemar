import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { defaultLlmProfiles } from "../src/providers/llm.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/session-timeout-recovery");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
process.env.QDRANT_URL = "";
const { CodexSession } = await import("../src/codex/session.js");
const { ClaudeSession } = await import("../src/claude/session.js");
const profile = defaultLlmProfiles().find((entry) => entry.runtime === "codex")!;

function createSession(inactivityTimeoutMs = 0) {
  return new CodexSession({
    profile,
    cwd: process.env.CLAUDEMAR_DATA!,
    target: { targetType: "project", targetName: "qualichart" },
    resumeSessionId: "11111111-1111-4111-8111-111111111111",
    inactivityTimeoutMs,
  }, profile);
}

test("timeout invalidates the runner before publishing failure while preserving the conversation ID", async (t) => {
  const session = createSession(10);
  t.after(() => session.end());
  const turn = { abort: new AbortController(), done: false };
  Object.assign(session, { currentTurn: turn, queuedTurns: 1 });
  session.on("result", () => assert.equal(session.isAlive(), false));
  const result = await session.waitForResult();
  assert.equal(result.isError, true);
  assert.equal(result.sessionId, session.getSessionId());
  assert.equal(turn.abort.signal.aborted, true);
  assert.equal(Reflect.get(session, "skipTurns"), 0);
  assert.throws(() => session.sendUserMessage("Prosseguir"), /Runner encerrado/);
  assert.throws(() => ClaudeSession.prototype.sendUserMessage.call(session, "Prosseguir"), /Runner encerrado/);
  const replacement = createSession();
  t.after(() => replacement.end());
  assert.equal(replacement.getSessionId(), result.sessionId);
  assert.equal(replacement.isAlive(), true);
});

test("aborting skips only queued turns, never the next newly submitted turn", async (t) => {
  const session = createSession();
  t.after(() => session.end());
  const internals = session as unknown as {
    abortCurrentTurn(): void;
    runTurn(message: string): Promise<void>;
    skipTurns: number;
    queuedTurns: number;
  };
  Object.assign(session, { currentTurn: { abort: new AbortController(), done: false }, queuedTurns: 3 });
  internals.abortCurrentTurn();
  assert.equal(internals.skipTurns, 2);
  assert.equal(internals.queuedTurns, 0);
  internals.abortCurrentTurn();
  assert.equal(internals.skipTurns, 2);
  await internals.runTurn("Mensagem antiga 1");
  await internals.runTurn("Mensagem antiga 2");
  assert.equal(internals.skipTurns, 0);
});
