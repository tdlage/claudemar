import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentDisposition } from "../src/server/route-utils.js";

test("nome ASCII sai igual em filename e filename*", () => {
  assert.equal(attachmentDisposition("report.zip"), `attachment; filename="report.zip"; filename*=UTF-8''report.zip`);
});

test("nome com acento e espaço usa fallback ASCII e filename* em UTF-8", () => {
  assert.equal(
    attachmentDisposition("relatório final.zip"),
    `attachment; filename="relat_rio final.zip"; filename*=UTF-8''relat%C3%B3rio%20final.zip`,
  );
});

test("aspas, barra invertida, % e caracteres reservados do RFC 5987 não quebram o header", () => {
  assert.equal(
    attachmentDisposition(`a"b\\c%d'(e).txt`),
    `attachment; filename="a_b_c_d'(e).txt"; filename*=UTF-8''a%22b%5Cc%25d%27%28e%29.txt`,
  );
});
