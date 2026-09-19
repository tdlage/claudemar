import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { nativePendingQuestion, CODEX_QUESTION_INSTRUCTIONS } from "../src/codex/questions.js";
import { defaultLlmProfiles } from "../src/providers/llm.js";

process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/codex-questions/native-data");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
const { BaseAgentSession } = await import("../src/runtime/base-session.js");
const { CodexSession } = await import("../src/codex/session.js");
const item = { id: "call-question", type: "agent_message", text: "Qual conta?\n- Conta A\n- Conta B", delivery: "async", questions: [{ title: "Qual conta?", options: ["Conta A", "Conta B"] }] };

test("native async questions preserve clickable options without parsing prose", () => {
  assert.deepEqual(nativePendingQuestion(item)?.questions[0].options.map((o) => o.label), ["Conta A", "Conta B"]);
  assert.equal(nativePendingQuestion({ id: "text", text: item.text }), null);
  assert.equal(nativePendingQuestion({ ...item, questions: [{ title: "" }] }), null);
  assert.deepEqual(nativePendingQuestion({ ...item, questions: [{ title: "Explique" }] })?.questions[0].options, []);
  assert.match(CODEX_QUESTION_INSTRUCTIONS, /Não use as ferramentas nativas/);
});

for (const targetType of ["agent", "project"] as const) {
  test(`${targetType}: native question appears immediately, stays pending and queues the actual answer once`, async () => {
    const profile = defaultLlmProfiles().find((p) => p.runtime === "codex")!;
    const session = Reflect.construct(BaseAgentSession, [{ profile, cwd: process.env.CLAUDEMAR_DATA!, target: { targetType, targetName: "test" } }], CodexSession) as InstanceType<typeof CodexSession>;
    const sent: string[] = [], shown: unknown[] = [];
    Object.assign(session, { currentTurn: { abort: new AbortController(), done: false }, nativeQuestionIds: new Set(), nativeQuestionResponses: [], sendUserMessage: (text: string) => sent.push(text) });
    const internals = session as unknown as { handleItem(item: unknown, phase: string): unknown; nativeQuestionResponses: Promise<void>[] };
    session.on("question", (question) => shown.push(question));
    internals.handleItem(item, "completed");
    internals.handleItem(item, "completed");
    assert.equal(shown.length, 1);
    assert.equal(sent.length, 0);
    assert.equal(session.respondQuestion(item.id, "Conta B"), true);
    await Promise.all(internals.nativeQuestionResponses);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /"Qual conta\?":"Conta B"/);
    assert.equal(session.respondQuestion(item.id, "Conta A"), false);
  });
}
