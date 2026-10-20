import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, utimes } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import type { RequestContext } from "../src/server/middleware.js";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.PROMPT_ATTACHMENT_QUOTA_MB = "1";
process.env.PROMPT_ATTACHMENT_RETENTION_DAYS = "30";
const output = resolve(import.meta.dirname, "../../.output/prompt-attachments-test");
await mkdir(output, { recursive: true });
const data = await mkdtemp(resolve(output, "data-"));
process.env.CLAUDEMAR_DATA = data;
const { promptAttachmentsRouter } = await import("../src/server/routes/prompt-attachments.js");
const { existingPromptAttachmentsDir, promptAttachmentsDir, purgePromptAttachments, sweepExpiredPromptAttachments } = await import("../src/prompt-attachments.js");
let server: Server;
let url: string;
let ctx: RequestContext | undefined = { role: "admin" };
const alice: RequestContext = { role: "user", userId: "user-1", name: "alice", projects: ["qualichart"], agents: [], projectTabs: {} };
const bob: RequestContext = { role: "user", userId: "user-2", name: "bob", projects: ["qualichart"], agents: [], projectTabs: {} };

interface Attachment { id: string; name: string; size: number; mediaType: string; path: string; instruction: string }

before(async () => {
  await mkdir(resolve(data, "projects/qualichart"), { recursive: true });
  await mkdir(resolve(data, "projects/other"), { recursive: true });
  await mkdir(resolve(data, "agents/helper"), { recursive: true });
  const app = express();
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use(promptAttachmentsRouter);
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

const upload = (base: string, filename: string | null, body: Uint8Array, type?: string) => {
  const params = new URLSearchParams({ base });
  if (filename !== null) params.set("filename", filename);
  if (type) params.set("type", type);
  return fetch(`${url}/?${params}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
};

test("stores any file byte-for-byte in the owner's folder and returns a readable reference", async () => {
  ctx = { role: "admin" };
  assert.equal(existingPromptAttachmentsDir("project", "qualichart", "admin"), null);
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10, 0x00]);
  const response = await upload("project:qualichart", "Relatório final.xlsx", bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(response.status, 201);
  const file = await response.json() as Attachment;
  assert.equal(file.name, "Relatório final.xlsx");
  assert.equal(file.size, bytes.length);
  assert.equal(dirname(dirname(file.path)), promptAttachmentsDir("project", "qualichart", "admin"));
  assert.equal(existingPromptAttachmentsDir("project", "qualichart", "admin"), dirname(dirname(file.path)));
  assert.deepEqual(new Uint8Array(await readFile(file.path)), bytes);
  assert.equal((await stat(file.path)).mode & 0o777, 0o600);
  assert.ok(file.instruction.includes(JSON.stringify(file.path)));

  assert.equal((await fetch(`${url}/${file.id}?base=project:qualichart`, { method: "DELETE" })).status, 200);
  await assert.rejects(stat(dirname(file.path)), { code: "ENOENT" });
});

test("each user gets a separate folder and cannot delete another user's attachment", async () => {
  ctx = alice;
  const mine = await (await upload("project:qualichart", "contrato.pdf", new Uint8Array([1, 2, 3]))).json() as Attachment;
  ctx = bob;
  assert.notEqual(promptAttachmentsDir("project", "qualichart", "bob"), dirname(dirname(mine.path)));
  await fetch(`${url}/${mine.id}?base=project:qualichart`, { method: "DELETE" });
  assert.deepEqual(new Uint8Array(await readFile(mine.path)), new Uint8Array([1, 2, 3]));
  ctx = alice;
  await fetch(`${url}/${mine.id}?base=project:qualichart`, { method: "DELETE" });
  await assert.rejects(stat(mine.path), { code: "ENOENT" });
  ctx = { role: "admin" };
});

test("filenames cannot escape the folder and stay within the filesystem byte limit", async () => {
  const traversal = await (await upload("agent:helper", "../../../etc/passwd", new Uint8Array([1]), "not a type")).json() as Attachment;
  assert.equal(traversal.name, "passwd");
  assert.equal(traversal.mediaType, "application/octet-stream");
  assert.equal(basename(dirname(traversal.path)), traversal.id);

  const hidden = await (await upload("agent:helper", ".env", new Uint8Array([1]))).json() as Attachment;
  assert.equal(hidden.name, "env");

  const long = await upload("agent:helper", `${"한".repeat(150)}.pdf`, new Uint8Array([1]));
  assert.equal(long.status, 201);
  const longFile = await long.json() as Attachment;
  assert.ok(Buffer.byteLength(longFile.name, "utf8") <= 200);
  assert.ok(longFile.name.endsWith(".pdf"));
  assert.ok(!longFile.name.includes("�"));
});

test("the per-owner quota rejects uploads that would exceed it and keeps nothing partial", async () => {
  ctx = alice;
  const base = "project:qualichart";
  const big = await upload(base, "a.bin", new Uint8Array(700 * 1024));
  assert.equal(big.status, 201);
  const overflow = await upload(base, "b.bin", new Uint8Array(500 * 1024));
  assert.equal(overflow.status, 413);
  assert.match((await overflow.json() as { error: string }).error, /Limite de 1 MB/);
  ctx = bob;
  assert.equal((await upload(base, "c.bin", new Uint8Array(500 * 1024))).status, 201);
  ctx = { role: "admin" };
});

test("rejects unauthorized targets, empty files, missing names and invalid ids", async () => {
  ctx = undefined;
  assert.equal((await upload("project:qualichart", "a.txt", new Uint8Array([1]))).status, 403);
  ctx = alice;
  for (const target of ["orchestrator", "project:other", "agent:helper", "project:../qualichart", "project:qualichart:extra", "project:missing"]) {
    assert.equal((await upload(target, "a.txt", new Uint8Array([1]))).status, 403, target);
  }
  assert.equal((await upload("project:qualichart", "a.txt", new Uint8Array())).status, 400);
  assert.equal((await upload("project:qualichart", null, new Uint8Array([1]))).status, 400);
  assert.equal((await fetch(`${url}/not-an-id?base=project:qualichart`, { method: "DELETE" })).status, 400);
  ctx = { role: "admin" };
});

test("expired attachments are swept and purging a target removes everything", async () => {
  const old = await (await upload("project:other", "old.md", new TextEncoder().encode("# old"))).json() as Attachment;
  const fresh = await (await upload("project:other", "fresh.md", new TextEncoder().encode("# fresh"))).json() as Attachment;
  const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await utimes(dirname(old.path), longAgo, longAgo);
  assert.ok(await sweepExpiredPromptAttachments() >= 1);
  await assert.rejects(stat(old.path), { code: "ENOENT" });
  assert.ok((await stat(fresh.path)).isFile());

  await purgePromptAttachments("project", "other");
  await assert.rejects(stat(fresh.path), { code: "ENOENT" });
  assert.equal(promptAttachmentsDir("agent", "..", "admin"), null);
  assert.equal(promptAttachmentsDir("project", "__commitpush:qualichart:main", "admin"), null);
});
