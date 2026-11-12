import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-isolation-admin-"));
process.env.BRAIN_USERS_ROOT = mkdtempSync(resolve(tmpdir(), "brain-isolation-users-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";
process.env.WHATSAPP_BRIDGE_URL = "http://127.0.0.1:1";

const LEGACY_DEVICE = "legacy-device";
const USER_DEVICE_OWNER = "cccccccc-dddd-4eee-8fff-000000000000";
mkdirSync(resolve(process.env.CLAUDEMAR_DATA, "data"), { recursive: true });
writeFileSync(
  resolve(process.env.CLAUDEMAR_DATA, "data", "brain-whatsapp-devices.json"),
  JSON.stringify({
    devices: [
      { id: LEGACY_DEVICE, owner: "admin", jid: "5531000000001@s.whatsapp.net" },
      { id: `claudemar-${USER_DEVICE_OWNER}`, owner: USER_DEVICE_OWNER, jid: "5531000000002@s.whatsapp.net" },
    ],
  }),
);

const { adminBrain, brainScope, forgetBrainScope, isBrainOwnerId, perScope } = await import("./scope.js");
const { ensureBrainTree } = await import("./paths.js");
const { brainKeys, getRedis } = await import("./redis.js");
const { brainOwnerCondition } = await import("./brain-index.js");
const { brainSettings } = await import("./settings.js");
const { runBrainRead, runRawThread, validBrainPath, validRawPath, containedAfterSymlink } = await import("./tools.js");
const { brainApiKeys } = await import("./api-keys.js");
const { acceptsChat, isChatSelected, mapWebhookToEvent, whatsappWebhookOwner } = await import("./connectors/whatsapp.js");
const { config } = await import("../config.js");

const USER_A = "11111111-2222-4333-8444-555555555555";
const USER_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const admin = adminBrain();
const userA = brainScope(USER_A);
const userB = brainScope(USER_B);

ensureBrainTree(admin);
ensureBrainTree(userA);
ensureBrainTree(userB);

after(() => {
  getRedis().disconnect();
  rmSync(config.brainRoot, { recursive: true, force: true });
  rmSync(config.brainUsersRoot, { recursive: true, force: true });
});

test("cada dono tem raiz, área privada, keyspace, índice e prefixo de objeto próprios", () => {
  const scopes = [admin, userA, userB];
  for (const field of ["root", "privateDir", "settingsFile", "googleTokensDir", "slackTokensFile", "mcpAuditFile", "keyPrefix", "indexType", "objectPrefix"] as const) {
    assert.equal(new Set(scopes.map((s) => s[field])).size, scopes.length, field);
  }
  assert.equal(admin.root, config.brainRoot);
  assert.ok(userA.root.startsWith(config.brainUsersRoot));
  assert.ok(!userA.root.startsWith(admin.root + "/"));
  assert.ok(brainKeys(userA).events.startsWith(`brain:user:${USER_A}:`));
  assert.ok(!brainKeys(userA).events.startsWith(brainKeys(userB).events));
  assert.deepEqual(brainOwnerCondition(userA), { key: "targetType", match: { value: `brain:user:${USER_A}` } });
  assert.deepEqual(brainOwnerCondition(admin), { key: "targetType", match: { value: "brain" } });
});

test("só 'admin' e UUIDs viram dono de brain: nada que monte caminho passa", () => {
  for (const owner of ["admin", USER_A]) assert.ok(isBrainOwnerId(owner));
  for (const owner of ["", "..", "../admin", `${USER_A}/..`, "user", USER_B.toUpperCase(), "admin\0"]) {
    assert.equal(isBrainOwnerId(owner), false, owner);
    assert.throws(() => brainScope(owner));
  }
});

test("estado em memória por dono não vaza e some quando o dono é esquecido", () => {
  const counter = perScope(() => ({ value: 0 }));
  counter(userA).value += 1;
  assert.equal(counter(userB).value, 0);
  assert.equal(counter(userA).value, 1);
  const temp = brainScope("99999999-2222-4333-8444-555555555555");
  counter(temp).value = 7;
  forgetBrainScope(temp.owner);
  assert.equal(counter(brainScope(temp.owner)).value, 0);
});

test("um brain de usuário não lê arquivos de outro brain, nem por caminho relativo nem por symlink", async () => {
  mkdirSync(resolve(admin.wikiDir, "people"), { recursive: true });
  writeFileSync(resolve(admin.wikiDir, "people", "segredo-admin.md"), "conteúdo do admin");
  mkdirSync(resolve(userB.rawDir, "email", "2026", "11"), { recursive: true });
  writeFileSync(resolve(userB.rawDir, "email", "2026", "11", "thread-b.md"), "conteúdo do usuário B");

  assert.match(await runBrainRead(userA, "wiki/people/segredo-admin.md"), /Arquivo não existe/);
  assert.match(await runBrainRead(admin, "wiki/people/segredo-admin.md"), /conteúdo do admin/);
  assert.equal(validBrainPath(userA, `../${USER_B}/wiki/index.md`), null);
  assert.equal(validRawPath(userA, `../${USER_B}/raw/email/2026/11/thread-b.md`), null);
  assert.match(await runRawThread(userA, "raw/email/2026/11/thread-b.md"), /não encontrada/);

  symlinkSync(admin.wikiDir, resolve(userA.wikiDir, "atalho"));
  const viaLink = validBrainPath(userA, "wiki/atalho/people/segredo-admin.md");
  assert.ok(viaLink);
  assert.equal(await containedAfterSymlink(userA, viaLink!), false);
  assert.match(await runBrainRead(userA, "wiki/atalho/people/segredo-admin.md"), /Caminho inválido/);
});

test("usuário altera só a parte de dono das settings; sistema é do admin e vale para todos", () => {
  const user = brainSettings(userA);
  user.updateOwner({
    gmailQuery: "label:importante",
    cadences: { gmailMs: 15_000 },
    llm: { triage: { providerId: "anthropic", model: "modelo-do-usuario" } },
    retrieval: { rerankMinScore: 0.99 },
  });
  assert.equal(user.get().gmailQuery, "label:importante");
  assert.equal(user.get().cadences.gmailMs, brainSettings(admin).get().cadences.gmailMs);
  assert.notEqual(user.get().llm.triage.model, "modelo-do-usuario");
  assert.notEqual(user.get().retrieval.rerankMinScore, 0.99);
  assert.equal(brainSettings(admin).get().gmailQuery, "");
  assert.throws(() => user.updateSystem({ cadences: { gmailMs: 15_000 } }));

  brainSettings(admin).updateSystem({ llm: { triage: { model: "modelo-do-admin" } } });
  assert.equal(user.get().llm.triage.model, "modelo-do-admin");

  user.flush();
  const stored = JSON.parse(readFileSync(userA.settingsFile, "utf-8")) as Record<string, unknown>;
  for (const section of ["llm", "cadences", "compile", "retrieval", "jev"]) assert.ok(!(section in stored), section);
  assert.equal(stored.gmailQuery, "label:importante");
  assert.equal(brainSettings(userB).get().gmailQuery, "");
});

test("chaves do MCP externo pertencem a um dono: listar e revogar não cruzam brains", () => {
  const adminKey = brainApiKeys.create(admin.owner, "admin");
  const userKey = brainApiKeys.create(USER_A, "usuário A");
  assert.ok(brainApiKeys.list(admin.owner).some((k) => k.id === adminKey.info.id));
  assert.ok(!brainApiKeys.list(admin.owner).some((k) => k.id === userKey.info.id));
  assert.ok(!brainApiKeys.list(USER_B).some((k) => k.id === userKey.info.id));
  assert.equal(brainApiKeys.revoke(USER_B, userKey.info.id), false);
  assert.equal(brainApiKeys.revoke(admin.owner, userKey.info.id), false);
  assert.equal(brainApiKeys.authenticate(userKey.key)?.owner, USER_A);
  assert.equal(brainApiKeys.authenticate(adminKey.key)?.owner, admin.owner);
  assert.equal(brainApiKeys.revokeAll(USER_A), 1);
  assert.equal(brainApiKeys.authenticate(userKey.key), null);
  assert.ok(brainApiKeys.authenticate(adminKey.key));
});

test("WhatsApp: só as conversas selecionadas entram, por JID ou LID, e sem seleção nada entra", () => {
  const mapped = mapWebhookToEvent({
    device_id: "5531999999999@s.whatsapp.net",
    payload: { chat_id: "5511988887777@s.whatsapp.net", chat_lid: "251556368777322@lid", message_id: "M1", text: "oi" },
  })!;
  assert.deepEqual(mapped.chatIds, ["5511988887777", "251556368777322"]);
  assert.equal(isChatSelected([], mapped.chatIds), false);
  assert.equal(isChatSelected([{ jid: "5511000000000@s.whatsapp.net", name: "outro", kind: "contact" }], mapped.chatIds), false);
  assert.equal(isChatSelected([{ jid: "5511988887777@s.whatsapp.net", name: "Fulano", kind: "contact" }], mapped.chatIds), true);
  assert.equal(isChatSelected([{ jid: "251556368777322@lid", name: "Fulano", kind: "contact" }], mapped.chatIds), true);

  const group = mapWebhookToEvent({ payload: { chat_jid: "120363166488862688@g.us", sender_jid: "553188751812@s.whatsapp.net", message_id: "G1", text: "oi" } })!;
  assert.equal(isChatSelected([{ jid: "120363166488862688@g.us", name: "Time", kind: "group" }], group.chatIds), true);
  assert.equal(isChatSelected([{ jid: "553188751812@s.whatsapp.net", name: "membro", kind: "contact" }], group.chatIds), false);
});

test("WhatsApp: o brain do admin aceita todas as conversas; o de usuário, só as selecionadas", () => {
  const chatIds = ["5511977776666"];
  brainSettings(userB).setWhatsappChats([]);
  assert.equal(acceptsChat(admin, chatIds), true);
  assert.equal(acceptsChat(userB, chatIds), false);
  brainSettings(userB).setWhatsappChats([{ jid: "5511977776666@s.whatsapp.net", name: "Fulana" }]);
  assert.equal(acceptsChat(userB, chatIds), true);
});

test("webhook do WhatsApp: o slot decide o dono; JID só sem slot; usuário inexistente nunca recebe", async () => {
  const body = (root: Record<string, unknown>) => ({ event: "message", ...root, payload: { chat_id: "5511988887777@s.whatsapp.net", id: "M", body: "oi" } });
  assert.equal((await whatsappWebhookOwner(body({ session_id: LEGACY_DEVICE })))?.owner, "admin");
  assert.equal(await whatsappWebhookOwner(body({ session_id: "slot-desconhecido", device_id: "5531000000001@s.whatsapp.net" })), null);
  assert.equal((await whatsappWebhookOwner(body({ device_id: "5531000000001@s.whatsapp.net" })))?.owner, "admin");
  assert.equal(await whatsappWebhookOwner(body({ session_id: `claudemar-${USER_DEVICE_OWNER}` })), null);
  assert.equal(await whatsappWebhookOwner(body({})), null);
});
