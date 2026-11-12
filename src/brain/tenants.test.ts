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
const { adminBrain } = await import("./scope.js");
const scope = adminBrain();
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

ensureBrainTree(scope);

test("cria contexto novo e resolve por rótulo, id e alias", async () => {
  const wink = await ensureTenant(scope, { label: "Wink", domains: ["wink.com.br"] });
  assert.equal(wink, "wink");
  assert.equal(await resolveTenantName(scope, "Wink"), "wink");
  assert.equal(await resolveTenantName(scope, "wink"), "wink");
  assert.equal(await resolveTenantName(scope, "Contabilidade Fulano"), null);
});

test("mesmo rótulo não duplica contexto", async () => {
  const first = await ensureTenant(scope, { label: "Numbr", parent: "Wink" });
  const again = await ensureTenant(scope, { label: "numbr" });
  assert.equal(first, again);
  const entries = await listTenants(scope);
  assert.equal(entries.filter((e) => e.id === "numbr").length, 1);
});

test("hierarquia: raiz e subárvore", async () => {
  await ensureTenant(scope, { label: "Bankr", parent: "Wink" });
  assert.equal(await tenantRoot(scope, "numbr"), "wink");
  assert.equal(await tenantRoot(scope, "wink"), "wink");
  const subtree = await tenantSubtree(scope, "wink");
  assert.ok(subtree.includes("wink"));
  assert.ok(subtree.includes("numbr"));
  assert.ok(subtree.includes("bankr"));
  assert.equal((await tenantSubtree(scope, "numbr")).length, 1);
});

test("resolve contexto pelo domínio do participante", async () => {
  assert.equal(await resolveTenantByHandles(scope, ["socio@wink.com.br"]), "wink");
  assert.equal(await resolveTenantByHandles(scope, ["alguem@app.wink.com.br"]), "wink");
  assert.equal(await resolveTenantByHandles(scope, ["alguem@outro.com"]), null);
});

test("fusão reaponta o id antigo e reparenta os filhos", async () => {
  await ensureTenant(scope, { label: "Bankr Pagamentos" });
  const result = await mergeTenants(scope, "bankr-pagamentos", "bankr");
  assert.equal(result.target, "bankr");
  assert.equal(await canonicalTenant(scope, "bankr-pagamentos"), "bankr");
  assert.equal(await resolveTenantName(scope, "Bankr Pagamentos"), "bankr");

  const sub = await ensureTenant(scope, { label: "BPO", parent: "Wink" });
  await ensureTenant(scope, { label: "BPO Fiscal", parent: sub });
  const merged = await mergeTenants(scope, "bpo", "wink");
  assert.deepEqual(merged.reparented, ["bpo-fiscal"]);
  assert.equal(await tenantRoot(scope, "bpo-fiscal"), "wink");
});

test("fusão inválida é recusada", async () => {
  await assert.rejects(() => mergeTenants(scope, "wink", "wink"), /mesmo contexto/);
  await assert.rejects(() => mergeTenants(scope, ROOT_TENANT, "wink"), /não pode ser fundido/);
  await assert.rejects(() => mergeTenants(scope, "wink", "numbr"), /ciclo/);
});

test("reparent recusa ciclo e aceita virar raiz", async () => {
  await assert.rejects(() => updateTenant(scope, "wink", { parent: "numbr" }), /descendente/);
  await assert.rejects(() => updateTenant(scope, "wink", { parent: "wink" }), /pai de si mesmo/);
  const updated = await updateTenant(scope, "numbr", { parent: null, label: "Numbr" });
  assert.equal(updated.parent, null);
  assert.equal(await tenantRoot(scope, "numbr"), "numbr");
});

test("contexto desconhecido é raiz de si mesmo, nunca cai no default", async () => {
  assert.equal(await canonicalTenant(scope, "inexistente"), "inexistente");
  assert.equal(await tenantRoot(scope, "inexistente"), "inexistente");
  assert.notEqual(await tenantRoot(scope, "inexistente"), ROOT_TENANT);
  assert.equal(await tenantRoot(scope, ""), ROOT_TENANT);
  assert.equal(await canonicalTenant(scope, ""), ROOT_TENANT);
});

test("reparent para neto é recusado (ciclo profundo)", async () => {
  const a = await ensureTenant(scope, { label: "Cadeia A" });
  const b = await ensureTenant(scope, { label: "Cadeia B", parent: a });
  const c = await ensureTenant(scope, { label: "Cadeia C", parent: b });
  await assert.rejects(() => updateTenant(scope, a, { parent: c }), /descendente/);
  assert.equal(await tenantRoot(scope, c), a);
});

test("fusão em descendente profundo é recusada", async () => {
  const p = await ensureTenant(scope, { label: "Cadeia P" });
  const q = await ensureTenant(scope, { label: "Cadeia Q", parent: p });
  const r = await ensureTenant(scope, { label: "Cadeia R", parent: q });
  await assert.rejects(() => mergeTenants(scope, p, r), /ciclo/);
  assert.equal(await tenantRoot(scope, r), p);
});

test("fusão devolve toda a subárvore reparentada, sem incluir o destino", async () => {
  const raiz = await ensureTenant(scope, { label: "Fusao Raiz" });
  const meio = await ensureTenant(scope, { label: "Fusao Meio", parent: raiz });
  const folha = await ensureTenant(scope, { label: "Fusao Folha", parent: meio });
  const destino = await ensureTenant(scope, { label: "Fusao Destino" });
  const result = await mergeTenants(scope, raiz, destino);
  assert.deepEqual(result.reparented.sort(), [folha, meio].sort());
  assert.equal(await tenantRoot(scope, folha), destino);
});

test("pai proposto ainda inexistente é criado junto", async () => {
  const filho = await ensureTenant(scope, { label: "Produto Novo", parent: "Holding Nova" });
  assert.equal(await tenantRoot(scope, filho), "holding-nova");
});
