import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { httpErrorHandler } from "../src/server/error-handler.js";

let server: Server;
let url: string;

before(async () => {
  const app = express();
  app.post("/small", express.json({ limit: "1kb" }), (_req, res) => { res.json({ ok: true }); });
  app.get("/boom", () => { throw new Error("segredo interno"); });
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
});

test("answers an oversized body with 413 and both sizes instead of a generic 500", async () => {
  const response = await fetch(`${url}/small`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "x".repeat(3000) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "O envio tem 2.9 KB e o limite do servidor é 1.0 KB." });
});

test("answers malformed JSON with 400", async () => {
  const response = await fetch(`${url}/small`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(response.status, 400);
  assert.ok(typeof (await response.json()).error === "string");
});

test("keeps unexpected failures opaque", async () => {
  const response = await fetch(`${url}/boom`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
});
