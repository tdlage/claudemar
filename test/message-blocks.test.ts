import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_IMAGES_TOTAL_BYTES,
  MessageBlocksError,
  messageText,
  parseImageBlocks,
  withText,
} from "../src/runtime/message-blocks.js";

const png = (data = "iVBORw0KGgo=") => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });

function rejects(value: unknown, status: number, pattern: RegExp) {
  assert.throws(() => parseImageBlocks(value), (error: unknown) => {
    assert.ok(error instanceof MessageBlocksError);
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

test("returns only the images, ignoring text blocks rebuilt by the server", () => {
  const images = parseImageBlocks([png(), { type: "text", text: "legenda" }, png("AAAA")]);
  assert.deepEqual(images, [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  ]);
  assert.deepEqual(parseImageBlocks(undefined), []);
  assert.deepEqual(parseImageBlocks(null), []);
});

test("rejects malformed blocks with a 400", () => {
  rejects("imagens", 400, /lista/);
  rejects([42], 400, /inválido/);
  rejects([{ type: "audio" }], 400, /inválido/);
  rejects([{ type: "image", source: { type: "base64", media_type: "image/bmp", data: "AAAA" } }], 400, /imagem 1 não é PNG, JPEG, GIF ou WebP/);
  rejects([png(), { type: "image", source: { type: "url", media_type: "image/png", data: "AAAA" } }], 400, /imagem 2/);
  rejects([png("não é base64")], 400, /corrompida/);
});

test("rejects an image above the per-image limit with a 413 that names it", () => {
  rejects([png(), png("A".repeat(MAX_PROMPT_IMAGE_BYTES + 4))], 413, /A imagem 2 tem 5\.0 MB; o limite por imagem é 5\.0 MB/);
});

test("rejects too many images or too many bytes in a single message", () => {
  rejects(Array.from({ length: MAX_PROMPT_IMAGES + 1 }, () => png()), 413, new RegExp(`${MAX_PROMPT_IMAGES + 1} imagens; o limite é ${MAX_PROMPT_IMAGES}`));
  const big = "A".repeat(MAX_PROMPT_IMAGE_BYTES - 4);
  const count = Math.ceil(MAX_PROMPT_IMAGES_TOTAL_BYTES / big.length) + 1;
  rejects(Array.from({ length: count }, () => png(big)), 413, /As imagens somam .* o limite é 32\.0 MB por mensagem/);
});

test("builds the text for messages sent by text or by blocks", () => {
  assert.equal(messageText("direto", [{ type: "text", text: "ignorado" }]), "direto");
  assert.equal(messageText(undefined, [png(), { type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(messageText(undefined, undefined), "");
  assert.deepEqual(withText([], ""), []);
  assert.deepEqual(withText([], "oi"), [{ type: "text", text: "oi" }]);
});
