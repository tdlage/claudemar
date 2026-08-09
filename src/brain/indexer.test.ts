import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-indexer-test-"));

const { diffFiles } = await import("./indexer.js");
const { dedupKey } = await import("./search.js");

test("diffFiles detecta novos, alterados e removidos", () => {
  const current = new Map([
    ["wiki/people/a.md", "hash-a"],
    ["wiki/people/b.md", "hash-b2"],
    ["wiki/orgs/c.md", "hash-c"],
  ]);
  const tracked = {
    "wiki/people/a.md": "hash-a",
    "wiki/people/b.md": "hash-b1",
    "wiki/projects/gone.md": "hash-x",
  };
  const diff = diffFiles(current, tracked);
  assert.deepEqual(diff.changed.sort(), ["wiki/orgs/c.md", "wiki/people/b.md"]);
  assert.deepEqual(diff.removed, ["wiki/projects/gone.md"]);
});

test("dedupKey normaliza caixa, acentos, espaços e pontuação nos primeiros 160 chars", () => {
  const a = dedupKey("# Visto Nômada!  Digital — status ATUAL.");
  const b = dedupKey("# visto nomada digital   status atual");
  assert.equal(a, b);
  assert.notEqual(dedupKey("outro texto totalmente diferente"), a);
  assert.ok(dedupKey("x".repeat(500)).length <= 160);
});
