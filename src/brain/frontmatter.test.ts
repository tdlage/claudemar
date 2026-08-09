import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { parseRawFile, serializeRawFile, parseWikiFile, serializeWikiFile } = await import("./frontmatter.js");
const typesModule = await import("./types.js");
type RawFrontmatter = import("./types.js").RawFrontmatter;
type WikiFrontmatter = import("./types.js").WikiFrontmatter;
void typesModule;

function sampleRaw(): RawFrontmatter {
  return {
    id: "a3f81c04e9b27d55",
    channel: "email",
    subchannel: "direct",
    account: "thiago@example.com",
    thread_key: "gmail:thiago@example.com:18f2a9c1d4e",
    tenant: "personal",
    contains_pii: 1,
    occurred_from: "2026-08-03T09:14:00+02:00",
    occurred_to: "2026-08-05T17:41:00+02:00",
    ingested_at: "2026-08-05T18:02:11+02:00",
    participants: [
      { name: "Amazon.es", handle: "no-reply@amazon.es", role: "from" },
      { name: "Thiago", handle: "thiago@example.com", role: "to" },
    ],
    subject: "Pedido 403-0761372-1570741",
    message_count: 7,
    chatter_filtered: 3,
    attachments: [{ name: "factura.pdf", sha256: "abc", uri: "file:///x", bytes: 88213 }],
  };
}

test("raw round-trip é byte-estável", () => {
  const body = "## [2026-08-03T09:14:00+02:00] Amazon.es <no-reply@amazon.es>\n\ncorpo da mensagem\n";
  const once = serializeRawFile(sampleRaw(), body);
  const parsed = parseRawFile(once);
  assert.ok(parsed);
  const twice = serializeRawFile(parsed.frontmatter, parsed.body);
  assert.equal(once, twice);
});

test("raw parse rejeita frontmatter inválido", () => {
  assert.equal(parseRawFile("---\nchannel: pigeon\n---\ncorpo"), null);
  assert.equal(parseRawFile("sem frontmatter nenhum"), null);
});

function sampleWiki(): WikiFrontmatter {
  return {
    type: "person",
    slug: "lucas-abad",
    title: "Lucas Gonçalves Abad",
    tenant: "personal",
    tenant_root: "personal",
    contains_pii: 0,
    aliases: ["Lucas Abad", "lucas@example.com"],
    status: "active",
    created_at: "2026-05-12",
    updated_at: "2026-08-05",
    reviewed_at: "2026-08-05",
    review_window: "6m",
    half_life: "365d",
    salience: 0.7,
    related: ["projects/visto-nomada-digital"],
    sources: ["raw/email/2026/07/2026-07-15--uge-ce--91c2aaaa.md"],
    independent_sources: 2,
    confidence: "medium",
    pinned: false,
  };
}

test("wiki round-trip é byte-estável e valida sources não-vazio", () => {
  const body = "## Identidade\n\nAdvogado em Sevilha.\n";
  const once = serializeWikiFile(sampleWiki(), body);
  const parsed = parseWikiFile(once);
  assert.ok(parsed);
  assert.equal(serializeWikiFile(parsed.frontmatter, parsed.body), once);
  const noSources = { ...sampleWiki(), sources: [] };
  const bad = serializeWikiFile(noSources as WikiFrontmatter, body);
  assert.equal(parseWikiFile(bad), null);
});
