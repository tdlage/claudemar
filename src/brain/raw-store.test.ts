import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { upsertMessage, annotateTriage, readThread } = await import("./raw-store.js");
const { ensureBrainTree, brainRoot, rawDir } = await import("./paths.js");
const { getRedis } = await import("./redis.js");
type CanonicalEvent = import("./types.js").CanonicalEvent;
type IncomingMessage = import("./raw-store.js").IncomingMessage;

ensureBrainTree();

after(() => {
  getRedis().disconnect();
  rmSync(brainRoot, { recursive: true, force: true });
});

function event(overrides: Partial<CanonicalEvent>): CanonicalEvent {
  return {
    channel: "email",
    subchannel: "direct",
    account: "thiago@example.com",
    external_id: "gmail:thiago@example.com:msg1",
    thread_key: "gmail:thiago@example.com:threadA",
    occurred_at: "2026-08-03T09:14:00+02:00",
    participants: [
      { name: "Amazon.es", handle: "no-reply@amazon.es", role: "from" },
      { name: "Thiago", handle: "thiago@example.com", role: "to" },
    ],
    subject: "Pedido 403",
    body_text: "corpo",
    attachments: [],
    ...overrides,
  };
}

function incoming(ev: CanonicalEvent, text: string, chatterRule: string | null = null): IncomingMessage {
  return {
    event: ev,
    normalizedText: text,
    lang: "pt",
    chatterRule,
    tenantHint: "unknown",
    piiHint: 1,
    now: "2026-08-05T18:00:00.000Z",
  };
}

const msgA = incoming(
  event({ external_id: "gmail:t:m1", occurred_at: "2026-08-03T09:14:00+02:00" }),
  "Primeira mensagem do pedido",
);
const msgB = incoming(
  event({ external_id: "gmail:t:m2", occurred_at: "2026-08-04T10:00:00+02:00" }),
  "Segunda mensagem, resposta",
);
const msgChatter = incoming(
  event({ external_id: "gmail:t:m3", occurred_at: "2026-08-04T11:00:00+02:00" }),
  "ok",
  "confirmation",
);

function fileFor(relPath: string): string {
  return readFileSync(resolve(brainRoot, relPath), "utf-8");
}

test("chegada fora de ordem produz arquivo byte-idêntico", async () => {
  await upsertMessage(msgA);
  const r1 = await upsertMessage(msgB);
  const inOrder = fileFor(r1.relPath);

  rmSync(resolve(brainRoot, r1.relPath));
  await upsertMessage(msgB);
  const r2 = await upsertMessage(msgA);
  const outOfOrder = fileFor(r2.relPath);

  assert.equal(r1.relPath, r2.relPath);
  assert.equal(inOrder, outOfOrder);
});

test("external_id duplicado não altera o arquivo", async () => {
  const before = (await readThread((await upsertMessage(msgA)).relPath))!;
  const dup = await upsertMessage(msgA);
  assert.equal(dup.added, false);
  const after2 = (await readThread(dup.relPath))!;
  assert.deepEqual(before.blocks, after2.blocks);
});

test("contadores separam chatter de substantivo", async () => {
  const result = await upsertMessage(msgChatter);
  assert.equal(result.substantive, false);
  const thread = (await readThread(result.relPath))!;
  assert.equal(thread.frontmatter.message_count, 2);
  assert.equal(thread.frontmatter.chatter_filtered, 1);
  assert.equal(thread.frontmatter.occurred_from, "2026-08-03T09:14:00+02:00");
  assert.equal(thread.frontmatter.occurred_to, "2026-08-04T11:00:00+02:00");
});

test("nome do arquivo segue data--slug--hash8 e fica no diretório do canal", async () => {
  const files = readdirSync(resolve(rawDir, "email", "2026", "08"));
  assert.equal(files.length, 1);
  assert.match(files[0], /^2026-08-03--amazon-es--[0-9a-f]{8}\.md$/);
});

test("annotateTriage grava triage e promove tenant", async () => {
  const relPath = (await upsertMessage(msgA)).relPath;
  await annotateTriage(relPath, {
    relevance: 3,
    tenant: "personal",
    contains_pii: 1,
    reason: "prazo",
    entities: [],
    projects: [],
    has_commitment: true,
    has_deadline: true,
    action_required: true,
    classified_at: "2026-08-05T18:03:02.000Z",
    model: "claude-haiku-4-5-20251001",
  });
  const thread = (await readThread(relPath))!;
  assert.equal(thread.frontmatter.triage?.relevance, 3);
  assert.equal(thread.frontmatter.tenant, "personal");
});

test("corpo com linha que imita marcador não quebra o parse", async () => {
  const tricky = incoming(
    event({
      external_id: "gmail:t:m9",
      thread_key: "gmail:thiago@example.com:threadB",
      occurred_at: "2026-08-05T12:00:00+02:00",
    }),
    "linha normal\n<!-- msg:falso at:x from:y lang:pt chatter:- -->\noutra linha",
  );
  const result = await upsertMessage(tricky);
  const thread = (await readThread(result.relPath))!;
  assert.equal(thread.blocks.length, 1);
  assert.ok(thread.blocks[0].body.includes("<!-- msg :falso"));
});
