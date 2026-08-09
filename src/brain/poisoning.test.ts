import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-poison-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { ensureBrainTree, brainRoot } = await import("./paths.js");
const { upsertMessage, annotateTriage, readThread } = await import("./raw-store.js");
const { normalizeMessage } = await import("./normalize.js");
const { validateCompileOutput, compileOutputSchema } = await import("./operations.js");
const { ATTACK_MESSAGES, ATTACK_OPERATIONS, BENIGN_MESSAGE } = await import("./poisoning.fixtures.js");
const { getRedis } = await import("./redis.js");
type CompileOutput = import("./types.js").CompileOutput;
type RawFrontmatter = import("./types.js").RawFrontmatter;

ensureBrainTree();

after(() => {
  getRedis().disconnect();
  rmSync(brainRoot, { recursive: true, force: true });
});

async function ingest(params: {
  name: string;
  subject: string;
  body: string;
  html?: string;
  subchannel?: "direct" | "group";
  channel?: "email" | "whatsapp";
}): Promise<string> {
  const normalized = normalizeMessage(params.body, params.html);
  const result = await upsertMessage({
    event: {
      channel: params.channel ?? "email",
      subchannel: params.subchannel ?? "direct",
      account: "thiago@example.com",
      external_id: `poison:${params.name}:m1`,
      thread_key: `poison:${params.name}`,
      occurred_at: "2026-08-05T10:00:00.000Z",
      participants: [{ name: "Remetente", handle: "sender@example.com", role: "from" }],
      subject: params.subject,
      body_text: params.body,
      attachments: [],
    },
    normalizedText: normalized.text || params.subject,
    lang: normalized.lang,
    chatterRule: null,
    tenantHint: "personal",
    piiHint: 0,
    now: "2026-08-05T12:00:00.000Z",
  });
  return result.relPath;
}

const benignPath = await ingest(BENIGN_MESSAGE);
await annotateTriage(benignPath, {
  relevance: 3,
  tenant: "personal",
  tenant_parent: null,
  tenant_evidence: "teste",
  contains_pii: 0,
  reason: "prazo",
  entities: ["Mallory"],
  projects: [],
  has_commitment: true,
  has_deadline: true,
  action_required: true,
  classified_at: "2026-08-05T12:01:00.000Z",
  model: "test",
});
const benignFm: RawFrontmatter = (await readThread(benignPath))!.frontmatter;

const groupPath = await ingest({
  name: "grupo",
  subject: "Grupo Família",
  body: "Combinado, sábado às 10h no clube.",
  subchannel: "group",
  channel: "whatsapp",
});
await annotateTriage(groupPath, {
  relevance: 3,
  tenant: "personal",
  tenant_parent: null,
  tenant_evidence: "teste",
  contains_pii: 1,
  reason: "logística",
  entities: [],
  projects: [],
  has_commitment: false,
  has_deadline: false,
  action_required: false,
  classified_at: "2026-08-05T12:01:00.000Z",
  model: "test",
});
const groupFm: RawFrontmatter = (await readThread(groupPath))!.frontmatter;

test("ataques de conteúdo entram como dado inerte, sem quebrar o formato raw", async () => {
  for (const attack of ATTACK_MESSAGES) {
    const relPath = await ingest(attack);
    const thread = await readThread(relPath);
    assert.ok(thread, `${attack.name}: raw file deve continuar parseável`);
    assert.equal(thread.blocks.length, 1, `${attack.name}: deve haver exatamente 1 bloco real`);
    assert.equal(thread.frontmatter.subject, attack.subject, `${attack.name}: frontmatter real preservado`);
    assert.equal(thread.frontmatter.tenant, "personal", `${attack.name}: tenant não pode ser alterado pelo conteúdo`);
    assert.equal(thread.frontmatter.contains_pii, 0, `${attack.name}: pii não pode ser alterado pelo conteúdo`);
  }
});

test("marcador forjado no corpo não cria mensagem fantasma", async () => {
  const attack = ATTACK_MESSAGES.find((a) => a.name === "injecao-de-marcador")!;
  const relPath = await ingest({ ...attack, name: "injecao-de-marcador-2" });
  const parsed = (await readThread(relPath))!;
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0].externalId, "poison:injecao-de-marcador-2:m1");
  assert.ok(!parsed.blocks.some((b) => b.externalId === "fake-id"), "marcador forjado não vira bloco");
});

test("frontmatter injetado no corpo não sobrescreve o frontmatter real", async () => {
  const relPath = await ingest({ ...ATTACK_MESSAGES.find((a) => a.name === "frontmatter-injetado")!, name: "frontmatter-injetado-2" });
  const parsed = (await readThread(relPath))!;
  assert.equal(parsed.frontmatter.subject, "Notas");
  assert.ok(parsed.blocks[0].body.includes("type: decision"), "conteúdo injetado permanece como dado");
});

test("todas as operações maliciosas são rejeitadas pelo validador", async () => {
  for (const set of ATTACK_OPERATIONS) {
    const fm = set.requiresGroupThread ? groupFm : benignFm;
    const validSource = set.requiresGroupThread ? groupPath : benignPath;
    const substitute = (arr: string[]): string[] => arr.map((s) => (s === "__VALID_SOURCE__" ? validSource : s));
    const output = compileOutputSchema.parse({
      operations: (set.operations ?? []).map((op) => ({ ...op, sources: substitute(op.sources) })),
      open_loops: (set.openLoops ?? []).map((l) => ({ ...l, sources: substitute(l.sources) })),
      log_entry: "",
      new_entities: [],
    }) as CompileOutput;
    const result = await validateCompileOutput(output, fm);
    assert.equal(result.ok, false, `${set.name}: deveria ser rejeitado`);
    assert.ok(result.errors.length > 0, `${set.name}: deve reportar erro`);
  }
});

test("operação legítima não é falso positivo", async () => {
  const output = compileOutputSchema.parse({
    operations: [
      {
        op: "create_page",
        path: "wiki/people/mallory-legitima.md",
        page_type: "person",
        title: "Mallory Legítima",
        tenant: "personal",
        tenant_parent: null,
        tenant_evidence: "teste",
        aliases: ["mallory@example.com"],
        sections: [{ section: "Identidade", content: "Contraparte do contrato em revisão." }],
        sources: [benignPath],
      },
      {
        op: "append_history",
        path: "wiki/people/mallory-legitima.md",
        content: "Pediu revisão da cláusula 4 até sexta.",
        sources: [benignPath],
      },
    ],
    open_loops: [
      {
        title: "Revisar cláusula 4",
        tenant: "personal",
        tenant_parent: null,
        tenant_evidence: "teste",
        kind: "my_commitment",
        counterparty: "Mallory",
        due: "2026-08-08",
        next_action: "Revisar e devolver",
        supersedes: null,
        sources: [benignPath],
      },
    ],
    log_entry: "## [2026-08-05] compile | teste",
    new_entities: [],
  }) as CompileOutput;
  const result = await validateCompileOutput(output, benignFm);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("fixtures cobrem pelo menos 15 ataques", () => {
  assert.ok(ATTACK_MESSAGES.length + ATTACK_OPERATIONS.length >= 15);
});
