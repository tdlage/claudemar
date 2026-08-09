import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { classifyChatter } = await import("./chatter.js");

const opts = { minChars: 12, extraConfirmations: ["fechou"] };

test("descarta confirmações curtas", () => {
  for (const text of ["ok", "OK!", "valeu", "vlw", "blz", "combinado", "gracias", "Vale", "thanks", "deu certo", "entendido", "Obrigado!"]) {
    assert.equal(classifyChatter(text, opts).chatter, true, `"${text}" deveria ser chatter`);
  }
});

test("descarta só-emoji e só-pontuação", () => {
  assert.equal(classifyChatter("👍", opts).rule, "no_alnum");
  assert.equal(classifyChatter("👍👍🎉", opts).rule, "no_alnum");
  assert.equal(classifyChatter("!!!???...", opts).rule, "no_alnum");
  assert.equal(classifyChatter("   ", opts).rule, "empty");
});

test("descarta texto abaixo de minChars", () => {
  assert.equal(classifyChatter("chego já", opts).rule, "min_chars");
});

test("confirmação extra configurável", () => {
  assert.equal(classifyChatter("Fechou", opts).rule, "confirmation_extra");
});

test("NÃO descarta mensagem substantiva começando com confirmação", () => {
  const v = classifyChatter("ok, mas o contrato precisa da cláusula de rescisão revisada antes de sexta", opts);
  assert.equal(v.chatter, false);
});

test("NÃO descarta pergunta curta acima do limite", () => {
  const v = classifyChatter("qual o número do expediente?", opts);
  assert.equal(v.chatter, false);
});

test("descarta rodapé automático", () => {
  assert.equal(classifyChatter("Enviado do meu iPhone", opts).rule, "auto_footer");
  assert.equal(classifyChatter("Não responda este e-mail. Mensagem automática.", opts).rule, "auto_footer");
});
