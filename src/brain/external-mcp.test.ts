import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-mcp-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { brainMcpRoute } = await import("./external-mcp.js");
const { brainApiKeys } = await import("./api-keys.js");
const { ensureBrainTree, brainRoot } = await import("./paths.js");
const { getRedis } = await import("./redis.js");
const { config } = await import("../config.js");

ensureBrainTree();
mkdirSync(resolve(brainRoot, "state", "quarantine"), { recursive: true });
writeFileSync(resolve(brainRoot, "state", "quarantine", "item.json"), '{"segredo":"quarentena"}');

let server: Server;
let url: string;

before(async () => {
  const app = express();
  app.all("/api/brain/mcp", ...brainMcpRoute);
  server = await new Promise<Server>((done) => {
    const listening = app.listen(0, "127.0.0.1", () => done(listening));
  });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/brain/mcp`;
});

after(async () => {
  await new Promise((done) => server.close(done));
  getRedis().disconnect();
  rmSync(brainRoot, { recursive: true, force: true });
});

async function connect(authorization: string): Promise<Client> {
  const client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: authorization } } }),
  );
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { text: string }[]).map((c) => c.text).join("\n");
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } },
};

function post(body: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", ...headers },
    body,
  });
}

test("chave válida lista as ferramentas somente leitura, lê o brain e fica na auditoria", async () => {
  const { key, info } = brainApiKeys.create("bot externo");
  const client = await connect(`Bearer ${key}`);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["brain_history", "brain_read", "brain_search", "claudemar_targets", "raw_grep", "raw_list", "raw_thread"],
    );
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
    assert.match(client.getInstructions() ?? "", /sem confirmação explícita do usuário/);

    const pins = textOf(await client.callTool({ name: "brain_read", arguments: { path: "state/pins.md" } }));
    assert.match(pins, /<<<INICIO_CONTEUDO_NAO_CONFIAVEL id=[0-9a-f]{12} /);
    assert.match(pins, /Pins/);
    assert.match(textOf(await client.callTool({ name: "brain_read", arguments: { path: "../etc/passwd" } })), /Caminho inválido/);
    assert.match(textOf(await client.callTool({ name: "claudemar_targets", arguments: {} })), /Orquestrador/);
  } finally {
    await client.close();
  }
  assert.ok(brainApiKeys.list().find((k) => k.id === info.id)?.lastUsedAt);
  const audited = brainApiKeys.readAudit(50).filter((e) => e.keyId === info.id).map((e) => e.tool);
  assert.ok(audited.includes("brain_read") && audited.includes("claudemar_targets"));
});

test("a quarentena não é alcançável por caminhos equivalentes", async () => {
  const { key } = brainApiKeys.create("quarentena");
  const client = await connect(`Bearer ${key}`);
  try {
    for (const path of ["state/quarantine", "state//quarantine/item.json", "state/./quarantine/item.json", "state/quarantine/item.json"]) {
      const out = textOf(await client.callTool({ name: "brain_read", arguments: { path } }));
      assert.doesNotMatch(out, /segredo/, path);
      assert.match(out, /Caminho inválido/, path);
    }
    const history = textOf(await client.callTool({ name: "brain_history", arguments: { path: "state/quarantine" } }));
    assert.match(history, /Caminho inválido/);
  } finally {
    await client.close();
  }
});

test("lote JSON-RPC, Content-Type malformado e corpo grande são recusados antes do SDK", async () => {
  const { key } = brainApiKeys.create("limites");
  const auth = { authorization: `Bearer ${key}` };
  const batch = await post(JSON.stringify([initialize, { ...initialize, id: 2 }]), { ...auth, "content-type": "application/json" });
  assert.equal(batch.status, 400);
  assert.equal(((await batch.json()) as { error: { code: number } }).error.code, -32600);

  const malformed = await post(JSON.stringify(initialize), { ...auth, "content-type": "application/json;" });
  assert.equal(malformed.status, 415);

  const big = await post(JSON.stringify({ ...initialize, padding: "x".repeat(200_000) }), { ...auth, "content-type": "application/json" });
  assert.equal(big.status, 413);

  const broken = await post("{quebrado", { ...auth, "content-type": "application/json" });
  assert.equal(broken.status, 400);
  assert.equal(((await broken.json()) as { error: { code: number } }).error.code, -32700);
});

test("sem chave, com chave errada ou revogada a requisição é recusada, e a revogação persiste no disco", async () => {
  const json = { "content-type": "application/json" };
  assert.equal((await post(JSON.stringify(initialize), json)).status, 401);
  assert.equal((await post("{quebrado", json)).status, 401);
  assert.equal((await post(JSON.stringify(initialize), { ...json, authorization: "Bearer cmb_inexistente" })).status, 401);

  const { key, info } = brainApiKeys.create("temporária");
  assert.equal((await post(JSON.stringify(initialize), { ...json, authorization: `Bearer ${key}` })).status, 200);
  assert.equal(brainApiKeys.revoke(info.id), true);
  assert.equal((await post(JSON.stringify(initialize), { ...json, authorization: `Bearer ${key}` })).status, 401);
  const stored = JSON.parse(readFileSync(resolve(config.dataPath, "brain-api-keys.json"), "utf-8")) as { id: string }[];
  assert.ok(!stored.some((k) => k.id === info.id));

  const get = await fetch(url, { headers: { authorization: `Bearer ${brainApiKeys.create("get").key}` } });
  assert.equal(get.status, 405);
});

test("a chave também é aceita sem o prefixo Bearer", async () => {
  const { key } = brainApiKeys.create("sem bearer");
  const client = await connect(key);
  try {
    assert.ok((await client.listTools()).tools.length > 0);
  } finally {
    await client.close();
  }
});
