import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUserInputMcpServer } from "../src/codex/questions.js";
import type { PendingQuestion } from "../src/providers/types.js";

test("Codex publica opções estruturadas e retorna as respostas recebidas", async (t) => {
  const received: PendingQuestion[] = [];
  const server = createUserInputMcpServer(async (question) => { received.push(question); return { "Preservar os acessos existentes?": "Preservar", "Qual nome usar?": "Admin" }; });
  const client = new Client({ name: "question-test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: "request_user_input", arguments: { questions: [
    { id: "access", question: "Preservar os acessos existentes?", options: [{ label: "Preservar" }, { label: "Revisar", description: "Nova liberação" }] },
    { question: "Qual nome usar?" },
  ] } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(received[0].questions, [
    { header: "access", question: "Preservar os acessos existentes?", multiSelect: false, options: [{ label: "Preservar", description: "" }, { label: "Revisar", description: "Nova liberação" }] },
    { header: "Pergunta", question: "Qual nome usar?", multiSelect: false, options: [] },
  ]);
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert.equal(JSON.parse(text).status, "answered");
  assert.equal(JSON.parse(text).requestId, received[0].toolUseId);
  assert.deepEqual(JSON.parse(text).answers, { "Preservar os acessos existentes?": "Preservar", "Qual nome usar?": "Admin" });

  const invalid = await client.callTool({ name: "request_user_input", arguments: { questions: [{ question: "  " }] } });
  assert.equal(invalid.isError, true);
  assert.equal(received.length, 1);
});

test("a tool não fabrica respostas quando a pergunta é cancelada", async (t) => {
  const server = createUserInputMcpServer(async () => { throw new Error("Cancelada"); });
  const client = new Client({ name: "question-test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: "request_user_input", arguments: { questions: [{ question: "Escolha?" }] } });
  assert.equal(result.isError, true);
});
