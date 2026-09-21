import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Server } from "node:http";
import express from "express";
import type { RequestContext } from "../src/server/middleware.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
const output = resolve(import.meta.dirname, "../../.output/confidential-attachments-test");
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, "data-"));
process.env.CLAUDEMAR_DATA = data;
const { confidentialAttachmentsRouter } = await import("../src/server/routes/confidential-attachments.js");
let server: Server;
let url: string;
let ctx: RequestContext | undefined = { role: "admin" };

before(async () => {
  await mkdir(resolve(data, "projects/qualichart"), { recursive: true });
  await mkdir(resolve(data, "projects/other"), { recursive: true });
  const app = express();
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use(confidentialAttachmentsRouter);
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

const upload = (base: string, content: unknown) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base, content }),
});

test("stores exact content in a private file and returns only a reference, isolated by target and owner", async () => {
  const secret = "API_KEY=test-secret-value\nPASSWORD=private-test-password\n";
  const response = await upload("project:qualichart", secret);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json() as { id: string; instruction: string };
  assert.equal(JSON.stringify(result).includes("private-test-password"), false);
  assert.equal(JSON.stringify(result).includes("test-secret-value"), false);
  const root = resolve(data, "data/confidential-attachments");
  const [scope] = await readdir(root);
  const path = resolve(root, scope, `${result.id}.txt`);
  assert.equal(await readFile(path, "utf8"), secret);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  assert.ok(result.instruction.includes(path));
  await fetch(`${url}/${result.id}?base=project:other`, { method: "DELETE" });
  assert.equal(await readFile(path, "utf8"), secret);
  ctx = { role: "user", userId: "user-1", name: "user", projects: ["qualichart"], agents: [], trackerProjects: [], projectTabs: {} };
  await fetch(`${url}/${result.id}?base=project:qualichart`, { method: "DELETE" });
  assert.equal(await readFile(path, "utf8"), secret);
  ctx = { role: "admin" };
  const removed = await fetch(`${url}/${result.id}?base=project:qualichart`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("rejects unauthorized scopes, traversal and invalid content without echoing it", async () => {
  ctx = undefined;
  assert.equal((await upload("project:qualichart", "secret")).status, 403);
  ctx = { role: "user", userId: "user-1", name: "user", projects: ["qualichart"], agents: [], trackerProjects: [], projectTabs: {} };
  for (const base of ["orchestrator", "project:other", "agent:other", "project:../qualichart", "project:qualichart:extra"]) {
    assert.equal((await upload(base, "secret")).status, 403);
  }
  for (const content of ["", "   ", null, {}, "é".repeat(32769)]) {
    assert.equal((await upload("project:qualichart", content)).status, 400);
  }
  const valid = await upload("project:qualichart", "allowed-test-value");
  assert.equal(valid.status, 201);
  const result = await valid.json() as { id: string };
  assert.equal((await fetch(`${url}/${result.id}?base=project:qualichart`, { method: "DELETE" })).status, 200);
});

test("malformed JSON and oversized bodies never echo submitted secrets", async () => {
  for (const [body, status] of [["private-test-password", 400], ["x".repeat(600 * 1024), 413]] as const) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Não foi possível processar o arquivo confidencial." });
  }
});
