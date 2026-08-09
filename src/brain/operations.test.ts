import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-ops-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { ensureBrainTree, brainRoot } = await import("./paths.js");
const { upsertMessage, annotateTriage, readThread } = await import("./raw-store.js");
const { validateCompileOutput, applyCompileOutput, compileOutputSchema } = await import("./operations.js");
const { getRedis } = await import("./redis.js");
const { flushIndexRegeneration } = await import("./wiki.js");
type CompileOutput = import("./types.js").CompileOutput;
type RawFrontmatter = import("./types.js").RawFrontmatter;

ensureBrainTree();

after(() => {
  getRedis().disconnect();
  rmSync(brainRoot, { recursive: true, force: true });
});

const upsert = await upsertMessage({
  event: {
    channel: "email",
    subchannel: "direct",
    account: "thiago@example.com",
    external_id: "gmail:ops:m1",
    thread_key: "gmail:thiago@example.com:opsthread",
    occurred_at: "2026-08-05T10:00:00+02:00",
    participants: [{ name: "Ivan", handle: "ivan@example.com", role: "from" }],
    subject: "Contrato",
    body_text: "corpo",
    attachments: [],
  },
  normalizedText: "Precisamos revisar a cláusula 4 do contrato até sexta.",
  lang: "pt",
  chatterRule: null,
  tenantHint: "personal",
  piiHint: 1,
  now: "2026-08-05T12:00:00.000Z",
});
const rawPath = upsert.relPath;
await annotateTriage(rawPath, {
  relevance: 3,
  tenant: "personal",
  tenant_parent: null,
  tenant_evidence: "teste",
  contains_pii: 1,
  reason: "prazo",
  entities: ["Ivan"],
  projects: [],
  has_commitment: true,
  has_deadline: true,
  action_required: true,
  classified_at: "2026-08-05T12:01:00.000Z",
  model: "claude-haiku-4-5-20251001",
});
const thread = (await readThread(rawPath))!;
const fm: RawFrontmatter = thread.frontmatter;

function baseOutput(overrides: Partial<CompileOutput>): CompileOutput {
  return compileOutputSchema.parse({
    operations: [],
    open_loops: [],
    log_entry: "## [2026-08-05] ingest | teste",
    new_entities: [],
    ...overrides,
  }) as CompileOutput;
}

const validCreate = {
  op: "create_page",
  path: "wiki/people/ivan.md",
  page_type: "person",
  title: "Ivan",
  tenant: "personal",
  tenant_parent: null,
  tenant_evidence: "teste",
  aliases: ["Ivan", "ivan@example.com"],
  sections: [{ section: "Identidade", content: "Contraparte do contrato." }],
  sources: [rawPath],
};

test("path traversal e path fora de wiki/ são rejeitados", async () => {
  const out = baseOutput({
    operations: [
      { ...validCreate, path: "wiki/../../etc/passwd.md" },
      { op: "upsert_section", path: "state/open-loops.md", section: "X", content: "y", sources: [rawPath] },
    ] as CompileOutput["operations"],
  });
  const result = await validateCompileOutput(out, fm);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("source inexistente é rejeitado", async () => {
  const out = baseOutput({
    operations: [{ ...validCreate, sources: ["raw/email/2026/08/nao-existe.md"] }] as CompileOutput["operations"],
  });
  const result = await validateCompileOutput(out, fm);
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes("não existe em raw/"));
});

test("contexto fora da árvore da thread é rejeitado", async () => {
  const out = baseOutput({
    operations: [{ ...validCreate, tenant: "outra-empresa" }] as CompileOutput["operations"],
  });
  const result = await validateCompileOutput(out, fm);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("contexto")));
});

test("seção acima do limite é rejeitada", async () => {
  const out = baseOutput({
    operations: [
      { ...validCreate, sections: [{ section: "Identidade", content: "x".repeat(5000) }] },
    ] as CompileOutput["operations"],
  });
  const result = await validateCompileOutput(out, fm);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("excede")));
});

test("create_page com relevance 3 é aceito e aplicado; replay de append é idempotente", async () => {
  const out = baseOutput({
    operations: [
      validCreate,
      {
        op: "append_history",
        path: "wiki/people/ivan.md",
        content: "Pediu revisão da cláusula 4 até sexta.",
        sources: [rawPath],
      },
    ] as CompileOutput["operations"],
    open_loops: [
      {
        title: "Revisar cláusula 4 do contrato",
        tenant: "personal",
        kind: "my_commitment",
        counterparty: "Ivan",
        due: "2026-08-08",
        next_action: "Revisar e devolver ao Ivan",
        supersedes: null,
        sources: [rawPath],
      },
    ],
  });
  const validation = await validateCompileOutput(out, fm);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);

  const threadKey = "gmail:thiago@example.com:opsthread";
  const first = await applyCompileOutput(threadKey, rawPath, out);
  assert.ok(first.pages.includes("wiki/people/ivan.md"));
  assert.equal(first.openLoops, 1);

  const second = await applyCompileOutput(threadKey, rawPath, out);
  assert.equal(second.openLoops, 0);

  const page = readFileSync(resolve(brainRoot, "wiki/people/ivan.md"), "utf-8");
  const occurrences = page.split("Pediu revisão da cláusula 4").length - 1;
  assert.equal(occurrences, 1);
  assert.ok(page.includes("confidence: low"));

  await flushIndexRegeneration();
  const index = readFileSync(resolve(brainRoot, "wiki/index.md"), "utf-8");
  assert.ok(index.includes("Ivan"));
  const compiled = (await readThread(rawPath))!.frontmatter.compiled_into ?? [];
  assert.ok(compiled.includes("wiki/people/ivan.md"));
});
