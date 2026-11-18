import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import type { RequestContext } from "../src/server/middleware.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.QDRANT_URL = "";
const output = resolve(import.meta.dirname, "../../.output/executions-route-limits");
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, "data-"));
process.env.CLAUDEMAR_DATA = data;
process.env.BRAIN_ROOT = resolve(data, "brain");
const { executionsRouter } = await import("../src/server/routes/executions.js");
const { httpErrorHandler } = await import("../src/server/error-handler.js");
const { PROMPT_BODY_LIMIT_BYTES, MAX_PROMPT_IMAGE_BYTES } = await import("../src/runtime/message-blocks.js");

let server: Server;
let url: string;
const ctx: RequestContext = { role: "admin" };

before(async () => {
  const app = express();
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use(express.json({ limit: PROMPT_BODY_LIMIT_BYTES }), executionsRouter);
  app.use(httpErrorHandler);
  server = await new Promise<Server>((done) => {
    const listening = app.listen(0, "127.0.0.1", () => done(listening));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  await rm(data, { recursive: true, force: true });
});

const image = (data: string) => ({ type: "image", source: { type: "base64", media_type: "image/webp", data } });
const post = (path: string, body: unknown) => fetch(`${url}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("names the oversized image instead of failing with a generic error", async () => {
  const response = await post("/", { targetType: "agent", targetName: "Beth", prompt: "roteiro", blocks: [image("AAAA"), image("A".repeat(MAX_PROMPT_IMAGE_BYTES + 4))] });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /^A imagem 2 tem 5\.0 MB/);
});

test("accepts a message made only of images", async () => {
  const response = await post("/", { targetType: "agent", targetName: "inexistente", prompt: "", blocks: [image("AAAA")] });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Agent not found" });
});

test("explains a body above the route limit with both sizes", async () => {
  const response = await post("/", `{"prompt":"${"x".repeat(PROMPT_BODY_LIMIT_BYTES)}"}`);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /^O envio tem 40\.0 MB e o limite do servidor é 40\.0 MB\.$/);
});

test("does not deliver messages to executions that do not exist", async () => {
  const response = await post("/missing/messages", { text: "continue" });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Execução não encontrada." });
});
