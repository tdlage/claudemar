import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { Thread, type ThreadEvent } from "@openai/codex-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defaultLlmProfiles } from "../src/providers/llm.js";
import type { PendingQuestion } from "../src/providers/types.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/codex-questions/turn-data");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
process.env.QDRANT_URL = "";
const { CodexSession } = await import("../src/codex/session.js");

test("a pergunta chega durante o turno e a execução continua no mesmo turno somente após receber a resposta", async (t) => {
  const inputs: unknown[] = [];
  const threadIds: Array<string | null> = [];
  const received: PendingQuestion[] = [];
  const profile = defaultLlmProfiles().find((p) => p.runtime === "codex")!;
  const session = new CodexSession({ profile, cwd: process.env.CLAUDEMAR_DATA!, target: { targetType: "project", targetName: "GED" }, model: "codex" }, profile);
  t.after(() => session.end());
  session.on("question", (question: PendingQuestion) => {
    received.push(question);
    setTimeout(() => {
      assert.equal(session.getLastResult(), null);
      assert.equal(session.respondQuestion(question.toolUseId, "Preservar os acessos atuais"), true);
    }, 20);
  });

  t.mock.method(Thread.prototype, "runStreamed", async function (this: Thread, input: unknown) {
    inputs.push(input);
    threadIds.push(this.id);
    const turn = inputs.length;
    const options = (this as unknown as { _options: { config: { developer_instructions: string; mcp_servers: Record<string, { url: string }> }; env: Record<string, string> } })._options;
    assert.match(options.config.developer_instructions, /mcp__user_input__request_user_input/);
    async function* events(): AsyncGenerator<ThreadEvent> {
      yield { type: "thread.started", thread_id: "thread-1" };
      if (turn === 1) {
        const client = new Client({ name: "codex-turn-test", version: "1" });
        const transport = new StreamableHTTPClientTransport(new URL(options.config.mcp_servers.user_input.url), {
          requestInit: { headers: { Authorization: `Bearer ${options.env.CLAUDEMAR_MCP_TOKEN}` } },
        });
        await client.connect(transport);
        try {
          const result = await client.callTool({ name: "request_user_input", arguments: { questions: [{ question: "Quais acessos manter?", options: [{ label: "Preservar os acessos atuais" }] }] } });
          assert.equal(result.isError, undefined);
          assert.equal(received.length, 1);
          assert.equal(inputs.length, 1);
          const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
          assert.deepEqual(payload.answers, { "Quais acessos manter?": "Preservar os acessos atuais" });
          assert.equal(payload.status, "answered");
        } finally {
          await client.close();
        }
      }
      yield { type: "item.completed", item: { id: `message-${turn}`, type: "agent_message", text: "Acessos preservados." } };
      yield { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } };
    }
    return { events: events() };
  });

  const done = session.waitForResult();
  session.sendUserMessage("Ajuste os acessos");
  const result = await done;
  assert.equal(result.isError, false);
  assert.deepEqual(inputs, ["Ajuste os acessos"]);
  assert.deepEqual(threadIds, [null]);
  assert.equal(result.sessionId, "thread-1");
  assert.equal(result.output, "Acessos preservados.");
  assert.equal(result.totalTokens, 15);
});
