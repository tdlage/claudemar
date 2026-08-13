import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-wa-webhook-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { mapWebhookToEvent } = await import("./connectors/whatsapp.js");

const base = {
  device_id: "wa",
  payload: {
    chat_id: "5511999999999@s.whatsapp.net",
    message_id: "MSG1",
    timestamp: "2026-08-10T15:00:00Z",
    pushname: "Fulano",
  },
};

test("nota de voz sem legenda é marcada para transcrição", () => {
  const mapped = mapWebhookToEvent({ ...base, payload: { ...base.payload, mimetype: "audio/ogg; codecs=opus" } })!;
  assert.equal(mapped.voiceNoteId, "MSG1");
  assert.equal(mapped.event.body_text, "[áudio sem transcrição]");
});

test("type ptt e audioMessage também contam como áudio", () => {
  assert.equal(mapWebhookToEvent({ ...base, payload: { ...base.payload, type: "ptt" } })!.voiceNoteId, "MSG1");
  const nested = { ...base, payload: { ...base.payload, message: { audioMessage: { seconds: 8 } } } };
  assert.equal(mapWebhookToEvent(nested)!.voiceNoteId, "MSG1");
});

test("áudio com legenda usa a legenda e não gasta transcrição", () => {
  const mapped = mapWebhookToEvent({
    ...base,
    payload: { ...base.payload, mimetype: "audio/ogg", caption: "segue o combinado" },
  })!;
  assert.equal(mapped.voiceNoteId, null);
  assert.equal(mapped.event.body_text, "segue o combinado");
});

test("mensagem de texto comum não vira transcrição", () => {
  const mapped = mapWebhookToEvent({ ...base, payload: { ...base.payload, message: "bom dia" } })!;
  assert.equal(mapped.voiceNoteId, null);
  assert.equal(mapped.event.body_text, "bom dia");
});

test("mídia não-áudio segue sem persistência", () => {
  const mapped = mapWebhookToEvent({ ...base, payload: { ...base.payload, mimetype: "image/jpeg" } })!;
  assert.equal(mapped.voiceNoteId, null);
  assert.equal(mapped.event.body_text, "[mensagem sem texto — mídia não persistida]");
});
