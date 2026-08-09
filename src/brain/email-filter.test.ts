import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { buildCategoryQuery, skippedByLabels, matchesBlockedSender, detectBulk } = await import("./email-filter.js");

test("buildCategoryQuery gera exclusões válidas e ignora categoria desconhecida", () => {
  assert.equal(buildCategoryQuery(["promotions", "social"]), "-category:promotions -category:social");
  assert.equal(buildCategoryQuery(["promotions", "invalida"]), "-category:promotions");
  assert.equal(buildCategoryQuery([]), "");
});

test("skippedByLabels pega spam/lixeira sempre e categorias configuradas", () => {
  assert.equal(skippedByLabels(["INBOX", "SPAM"], []), "spam");
  assert.equal(skippedByLabels(["TRASH"], []), "trash");
  assert.equal(skippedByLabels(["INBOX", "CATEGORY_PROMOTIONS"], ["promotions"]), "promotions");
  assert.equal(skippedByLabels(["INBOX", "CATEGORY_PROMOTIONS"], ["social"]), null);
  assert.equal(skippedByLabels(["INBOX", "CATEGORY_UPDATES"], ["updates"]), "updates");
  assert.equal(skippedByLabels(undefined, ["promotions"]), null);
});

test("matchesBlockedSender casa email exato e domínio com subdomínios", () => {
  const blocked = ["promo@loja.com", "mailchimp.com"];
  assert.equal(matchesBlockedSender("promo@loja.com", blocked), true);
  assert.equal(matchesBlockedSender("PROMO@LOJA.COM", blocked), true);
  assert.equal(matchesBlockedSender("outro@loja.com", blocked), false);
  assert.equal(matchesBlockedSender("news@mailchimp.com", blocked), true);
  assert.equal(matchesBlockedSender("x@mail.mailchimp.com", blocked), true);
  assert.equal(matchesBlockedSender("x@notmailchimp.com", blocked), false);
  assert.equal(matchesBlockedSender("", blocked), false);
});

test("detectBulk identifica newsletters e notificações automáticas", () => {
  assert.equal(detectBulk({ listUnsubscribe: "<mailto:unsub@x.com>" }), "list-unsubscribe");
  assert.equal(detectBulk({ listId: "<news.example.com>" }), "list-id");
  assert.equal(detectBulk({ precedence: "bulk" }), "precedence");
  assert.equal(detectBulk({ precedence: "list" }), "precedence");
  assert.equal(detectBulk({ autoSubmitted: "auto-generated" }), "auto-submitted");
  assert.equal(detectBulk({ autoSubmitted: "no" }), null);
  assert.equal(detectBulk({ fromHandle: "no-reply@banco.com" }), "noreply-sender");
  assert.equal(detectBulk({ fromHandle: "noreply@banco.com" }), "noreply-sender");
  assert.equal(detectBulk({ fromHandle: "newsletter@site.com" }), "noreply-sender");
  assert.equal(detectBulk({ fromHandle: "lucas@escritorio.com" }), null);
  assert.equal(detectBulk({}), null);
});
