import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-regressions-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { computeDocKey } = await import("./operations.js");
const { reviewOverdue } = await import("./lint.js");
const { batchCustomId } = await import("./llm.js");
const { brainSettingsManager } = await import("./settings.js");
const { getRedis } = await import("./redis.js");
type CompileOperation = import("./types.js").CompileOperation;
type WikiFrontmatter = import("./types.js").WikiFrontmatter;

test("append_history no mesmo arquivo gera docKeys distintos por conteúdo", () => {
  const base = { op: "append_history" as const, path: "wiki/people/joao.md", sources: ["raw/email/2026/08/a.md"] };
  const first: CompileOperation = { ...base, content: "Mudou de cargo" };
  const second: CompileOperation = { ...base, content: "Assinou contrato" };

  assert.notEqual(computeDocKey("email:t1", first), computeDocKey("email:t1", second));
  assert.equal(computeDocKey("email:t1", first), computeDocKey("email:t1", { ...base, content: "Mudou de cargo" }));
});

test("docKey separa operações por tipo e por thread", () => {
  const path = "wiki/people/joao.md";
  const sources = ["raw/email/2026/08/a.md"];
  const append: CompileOperation = { op: "append_history", path, content: "x", sources };
  const upsert: CompileOperation = { op: "upsert_section", path, section: "x", content: "y", sources };

  assert.notEqual(computeDocKey("t1", append), computeDocKey("t1", upsert));
  assert.notEqual(computeDocKey("t1", append), computeDocKey("t2", append));
});

function page(reviewedAt: string, window: string): WikiFrontmatter {
  return {
    type: "person",
    slug: "x",
    title: "X",
    tenant: "personal",
    contains_pii: 0,
    aliases: [],
    status: "active",
    created_at: reviewedAt,
    updated_at: reviewedAt,
    reviewed_at: reviewedAt,
    review_window: window,
    half_life: "365d",
    salience: 0.5,
    related: [],
    sources: ["raw/email/2026/01/a.md"],
    independent_sources: 1,
    confidence: "low",
    pinned: false,
  };
}

test("janela de revisão não transborda o fim do mês", () => {
  assert.equal(reviewOverdue(page("2026-01-31", "1m"), "2026-02-28"), false);
  assert.equal(reviewOverdue(page("2026-01-31", "1m"), "2026-03-01"), true);
  assert.equal(reviewOverdue(page("2026-01-15", "6m"), "2026-07-14"), false);
  assert.equal(reviewOverdue(page("2026-01-15", "6m"), "2026-07-16"), true);
  assert.equal(reviewOverdue(page("2026-01-15", "none"), "2030-01-01"), false);
});

test("custom_id de batch respeita o padrão da Batch API", () => {
  const pattern = /^[a-zA-Z0-9_-]{1,64}$/;
  for (const key of [
    "gmail:tdlage@gmail.com:18f2c9abc",
    "wa:5511999999999:120363@g.us:2026-08-09",
    "gcal:conta.empresa@biosoft.com.br:evento_1",
  ]) {
    const id = batchCustomId(key);
    assert.ok(pattern.test(id), `${id} deveria casar com o padrão`);
    assert.equal(id, batchCustomId(key));
  }
  assert.notEqual(batchCustomId("a"), batchCustomId("b"));
});

test("patch parcial de settings preserva campos irmãos", () => {
  brainSettingsManager.update({
    cadences: { gmailMs: 45_000 },
    emailFilter: { blockedSenders: ["spam@x.com"] },
    llm: { triage: { model: "modelo-custom" } },
  });
  const after = brainSettingsManager.get();

  assert.equal(after.cadences.gmailMs, 45_000);
  assert.equal(after.cadences.triageMs, 60_000);
  assert.deepEqual(after.emailFilter.blockedSenders, ["spam@x.com"]);
  assert.deepEqual(after.emailFilter.skipCategories, ["promotions", "social"]);
  assert.equal(after.llm.triage.model, "modelo-custom");
  assert.equal(after.llm.triage.providerId, "anthropic");
  assert.equal(after.llm.compile.model, "claude-sonnet-5");
  assert.equal(after.llm.providers.length, 3);

  getRedis().disconnect();
});
