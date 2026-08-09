import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { stripQuotes, stripSignature, htmlToMarkdown, normalizeMessage, MAX_EVENT_CHARS } = await import("./normalize.js");

test("stripQuotes remove blocos citados em pt/es/en", () => {
  const en = "Sure, works for me.\n\nOn Mon, Aug 3, 2026 at 9:14 AM John <j@x.com> wrote:\n> old content\n> more old";
  assert.equal(stripQuotes(en), "Sure, works for me.");
  const pt = "Combinado, seguimos assim.\n\nEm seg., 3 de ago. de 2026, Lucas escreveu:\n> texto antigo";
  assert.equal(stripQuotes(pt), "Combinado, seguimos assim.");
  const es = "Perfecto, gracias.\n\nEl lun, 3 ago 2026 a las 9:14, Iván escribió:\n> texto viejo";
  assert.equal(stripQuotes(es), "Perfecto, gracias.");
});

test("stripQuotes remove linhas > e bloco de cabeçalho de forward", () => {
  const fwd = "Segue abaixo.\n\nDe: Fulano <f@x.com>\nEnviado: segunda-feira\nPara: Thiago\nAssunto: Fatura\n\ncorpo antigo";
  assert.equal(stripQuotes(fwd), "Segue abaixo.");
  assert.equal(stripQuotes("linha nova\n> citada\nlinha final"), "linha nova\nlinha final");
});

test("stripSignature corta em -- e em despedidas no fim", () => {
  assert.equal(stripSignature("Corpo da mensagem.\n--\nThiago Lage\n+34 600 000 000"), "Corpo da mensagem.");
  assert.equal(stripSignature("Corpo.\n\nAtenciosamente,\nThiago"), "Corpo.");
  const noSig = "Texto sem assinatura nenhuma";
  assert.equal(stripSignature(noSig), noSig);
});

test("htmlToMarkdown converte html básico", () => {
  const md = htmlToMarkdown("<p>Olá <strong>mundo</strong></p><ul><li>um</li><li>dois</li></ul>");
  assert.ok(md.includes("**mundo**"));
  assert.ok(md.includes("- um") || md.includes("-   um"));
});

test("normalizeMessage aplica cap de 20k com flag truncated", () => {
  const big = "x".repeat(MAX_EVENT_CHARS + 500);
  const result = normalizeMessage(big);
  assert.equal(result.text.length, MAX_EVENT_CHARS);
  assert.equal(result.truncated, true);
  const small = normalizeMessage("mensagem pequena de teste você");
  assert.equal(small.truncated, false);
  assert.equal(small.lang, "pt");
});
