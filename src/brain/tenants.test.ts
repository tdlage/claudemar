import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-tenants-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { ensureBrainTree } = await import("./paths.js");
const {
  ROOT_TENANT,
  canonicalTenant,
  ensureTenant,
  listTenants,
  mergeTenants,
  resolveTenantByHandles,
  resolveTenantName,
  tenantRoot,
  tenantSubtree,
  updateTenant,
} = await import("./tenants.js");

ensureBrainTree();

test("cria contexto novo e resolve por rótulo, id e alias", async () => {
  const wink = await ensureTenant({ label: "Wink", domains: ["wink.com.br"] });
  assert.equal(wink, "wink");
  assert.equal(await resolveTenantName("Wink"), "wink");
  assert.equal(await resolveTenantName("wink"), "wink");
  assert.equal(await resolveTenantName("Contabilidade Fulano"), null);
});

test("mesmo rótulo não duplica contexto", async () => {
  const first = await ensureTenant({ label: "Numbr", parent: "Wink" });
  const again = await ensureTenant({ label: "numbr" });
  assert.equal(first, again);
  const entries = await listTenants();
  assert.equal(entries.filter((e) => e.id === "numbr").length, 1);
});

test("hierarquia: raiz e subárvore", async () => {
  await ensureTenant({ label: "Bankr", parent: "Wink" });
  assert.equal(await tenantRoot("numbr"), "wink");
  assert.equal(await tenantRoot("wink"), "wink");
  const subtree = await tenantSubtree("wink");
  assert.ok(subtree.includes("wink"));
  assert.ok(subtree.includes("numbr"));
  assert.ok(subtree.includes("bankr"));
  assert.equal((await tenantSubtree("numbr")).length, 1);
});

test("resolve contexto pelo domínio do participante", async () => {
  assert.equal(await resolveTenantByHandles(["socio@wink.com.br"]), "wink");
  assert.equal(await resolveTenantByHandles(["alguem@app.wink.com.br"]), "wink");
  assert.equal(await resolveTenantByHandles(["alguem@outro.com"]), null);
});

test("fusão reaponta o id antigo e reparenta os filhos", async () => {
  await ensureTenant({ label: "Bankr Pagamentos" });
  const result = await mergeTenants("bankr-pagamentos", "bankr");
  assert.equal(result.target, "bankr");
  assert.equal(await canonicalTenant("bankr-pagamentos"), "bankr");
  assert.equal(await resolveTenantName("Bankr Pagamentos"), "bankr");

  const sub = await ensureTenant({ label: "BPO", parent: "Wink" });
  await ensureTenant({ label: "BPO Fiscal", parent: sub });
  const merged = await mergeTenants("bpo", "wink");
  assert.deepEqual(merged.reparented, ["bpo-fiscal"]);
  assert.equal(await tenantRoot("bpo-fiscal"), "wink");
});

test("fusão inválida é recusada", async () => {
  await assert.rejects(() => mergeTenants("wink", "wink"), /mesmo contexto/);
  await assert.rejects(() => mergeTenants(ROOT_TENANT, "wink"), /não pode ser fundido/);
  await assert.rejects(() => mergeTenants("wink", "numbr"), /ciclo/);
});

test("reparent recusa ciclo e aceita virar raiz", async () => {
  await assert.rejects(() => updateTenant("wink", { parent: "numbr" }), /descendente/);
  await assert.rejects(() => updateTenant("wink", { parent: "wink" }), /pai de si mesmo/);
  const updated = await updateTenant("numbr", { parent: null, label: "Numbr" });
  assert.equal(updated.parent, null);
  assert.equal(await tenantRoot("numbr"), "numbr");
});

test("contexto desconhecido é raiz de si mesmo, nunca cai no default", async () => {
  assert.equal(await canonicalTenant("inexistente"), "inexistente");
  assert.equal(await tenantRoot("inexistente"), "inexistente");
  assert.notEqual(await tenantRoot("inexistente"), ROOT_TENANT);
  assert.equal(await tenantRoot(""), ROOT_TENANT);
  assert.equal(await canonicalTenant(""), ROOT_TENANT);
});
