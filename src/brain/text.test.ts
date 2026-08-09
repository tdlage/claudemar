import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { normalizeForIndex, slugify, hash8, detectLanguage, dateInTz, dayKeyInTz } = await import("./text.js");

test("normalizeForIndex remove diacríticos e normaliza espaços", () => {
  assert.equal(normalizeForIndex("Expediente  ÁGUA"), "expediente agua");
  assert.equal(normalizeForIndex("IRPF"), "irpf");
  assert.equal(normalizeForIndex("São  João\n da  Boa Vista"), "sao joao da boa vista");
});

test("slugify gera kebab-case sem acentos com limite", () => {
  assert.equal(slugify("Lucas Gonçalves Abad"), "lucas-goncalves-abad");
  assert.equal(slugify("Pedido #403-0761372!"), "pedido-403-0761372");
  assert.equal(slugify(""), "sem-assunto");
  assert.ok(slugify("a".repeat(100)).length <= 40);
});

test("hash8 é determinístico e tem 8 chars hex", () => {
  assert.equal(hash8("gmail:x@y.com:abc"), hash8("gmail:x@y.com:abc"));
  assert.match(hash8("gmail:x@y.com:abc"), /^[0-9a-f]{8}$/);
  assert.notEqual(hash8("a"), hash8("b"));
});

test("detectLanguage distingue pt/es/en", () => {
  assert.equal(detectLanguage("Obrigado, você já pode enviar o documento amanhã então"), "pt");
  assert.equal(detectLanguage("Gracias, usted puede enviar el documento mañana pero aquí"), "es");
  assert.equal(detectLanguage("Thanks, you are welcome, please send the document tomorrow with this"), "en");
});

test("dateInTz respeita o fuso na virada do dia", () => {
  const d = new Date("2026-08-05T23:30:00Z");
  const madrid = dateInTz(d, "Europe/Madrid");
  assert.deepEqual(madrid, { yyyy: "2026", mm: "08", dd: "06" });
  assert.equal(dayKeyInTz(d, "UTC"), "2026-08-05");
});
