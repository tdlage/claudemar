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

test("payload real do bridge: remetente e nome do grupo vêm dos campos certos", () => {
  const mapped = mapWebhookToEvent({
    device_id: "5531999999999@s.whatsapp.net",
    payload: {
      chat_jid: "120363166488862688@g.us",
      sender_jid: "553188751812@s.whatsapp.net",
      sender_display_name: "Joana",
      message_id: "3BC0008C371851AFC497",
      timestamp: "2026-08-13T23:55:44Z",
      text: "combinado então",
      chat_info: { name: "Time Produto" },
    },
  })!;
  assert.equal(mapped.event.subchannel, "group");
  assert.equal(mapped.event.subject, "Time Produto");
  assert.equal(mapped.event.participants[0].name, "Joana");
  assert.equal(mapped.event.participants[0].handle, "553188751812@s.whatsapp.net");
  assert.equal(mapped.event.body_text, "combinado então");
});

test("sem nome do remetente cai no número, nunca no JID do grupo", () => {
  const mapped = mapWebhookToEvent({
    device_id: "wa",
    payload: {
      chat_jid: "120363166488862688@g.us",
      sender_jid: "553188751812@s.whatsapp.net",
      message_id: "M2",
      timestamp: "2026-08-13T23:55:44Z",
      text: "oi",
    },
  })!;
  assert.equal(mapped.event.participants[0].name, "553188751812");
});
