import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-waexp-test-"));

const { parseWhatsappExport, chatNameFromFilename, exportToEvents } = await import("./whatsapp-export.js");

test("parser Android pt-BR com continuação e mensagem de sistema", () => {
  const content = [
    "05/08/2026 09:14 - As mensagens são protegidas com criptografia de ponta a ponta.",
    "05/08/2026 09:15 - Lucas Abad: Bom dia, o expediente saiu",
    "segunda linha da mesma mensagem",
    "05/08/2026 21:30 - Thiago: Perfeito, obrigado!",
  ].join("\n");
  const messages = parseWhatsappExport(content, "Europe/Madrid");
  assert.equal(messages.length, 3);
  assert.equal(messages[0].system, true);
  assert.equal(messages[1].sender, "Lucas Abad");
  assert.ok(messages[1].text.includes("segunda linha"));
  assert.equal(messages[2].sender, "Thiago");
  assert.equal(new Date(messages[1].at).toISOString(), "2026-08-05T07:15:00.000Z");
});

test("parser iOS com segundos e colchetes", () => {
  const content = [
    "[05/08/2026, 09:15:30] Lucas Abad: mensagem ios",
    "[05/08/2026, 09:16:00] Thiago: resposta",
  ].join("\n");
  const messages = parseWhatsappExport(content, "UTC");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].sender, "Lucas Abad");
  assert.equal(new Date(messages[0].at).toISOString(), "2026-08-05T09:15:30.000Z");
});

test("heurística mm/dd quando o segundo campo excede 12", () => {
  const content = "08/25/2026, 9:15 PM - John: hello there friend";
  const messages = parseWhatsappExport(content, "UTC");
  assert.equal(messages.length, 1);
  assert.equal(new Date(messages[0].at).toISOString(), "2026-08-25T21:15:00.000Z");
});

test("chatNameFromFilename remove prefixos de export", () => {
  assert.equal(chatNameFromFilename("Conversa do WhatsApp com Lucas Abad.txt"), "Lucas Abad");
  assert.equal(chatNameFromFilename("WhatsApp Chat with John.txt"), "John");
});

test("exportToEvents monta eventos com janela diária e detecção de grupo", () => {
  const direct = exportToEvents({
    filename: "Conversa do WhatsApp com Lucas Abad.txt",
    content: [
      "05/08/2026 02:00 - Lucas Abad: madrugada (janela do dia anterior)",
      "05/08/2026 10:00 - Thiago: manhã",
    ].join("\n"),
  });
  assert.equal(direct.length, 2);
  assert.equal(direct[0].subchannel, "direct");
  assert.notEqual(direct[0].thread_key, direct[1].thread_key);
  assert.ok(direct[0].thread_key.startsWith("wa:whatsapp:lucas-abad:"));

  const group = exportToEvents({
    filename: "Conversa do WhatsApp com Grupo Escola.txt",
    content: [
      "05/08/2026 10:00 - Maria: reunião amanhã às 18h",
      "05/08/2026 10:01 - João: confirmado por aqui",
      "05/08/2026 10:02 - Pedro: eu também vou",
    ].join("\n"),
  });
  assert.equal(group[0].subchannel, "group");
});
