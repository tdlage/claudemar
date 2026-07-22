import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const {
  applyProfile,
  defaultLlmProfiles,
  parseExtraEnv,
  sanitizeProfile,
  seedMissingDefaultProfiles,
  GATEWAY_TOKEN_ENV,
} = await import("../src/providers/llm.js");

function kimiProfile() {
  const profile = defaultLlmProfiles().find((p) => p.id === "kimi");
  assert.ok(profile, "perfil kimi deve existir nos defaults");
  return profile;
}

test("perfil kimi default aponta direto para o endpoint Anthropic-compatível da Moonshot", () => {
  const profile = kimiProfile();
  assert.equal(profile.label, "Kimi (K3)");
  assert.equal(profile.baseUrl, "https://api.moonshot.ai/anthropic");
  assert.equal(profile.tokenEnv, "KIMI_API_KEY");
  assert.equal(profile.opusModel, "kimi-k3[1m]");
  assert.equal(profile.sonnetModel, "kimi-k3[1m]");
  assert.equal(profile.haikuModel, "kimi-k3[1m]");
  assert.equal(profile.autoCompactWindow, "1048576");
});

test("applyProfile com kimi configura o ambiente da execução (criterios 1 e 2)", () => {
  process.env.KIMI_API_KEY = "sk-kimi-test";
  try {
    const env = applyProfile({ ANTHROPIC_API_KEY: "subscription-key" }, kimiProfile());
    assert.equal(env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk-kimi-test");
    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "kimi-k3[1m]");
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "kimi-k3[1m]");
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "kimi-k3[1m]");
    assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "1048576");
    assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, "kimi-k3[1m]");
    assert.equal(env.ENABLE_TOOL_SEARCH, "false");
    assert.equal("ANTHROPIC_API_KEY" in env, false);
  } finally {
    delete process.env.KIMI_API_KEY;
  }
});

test("applyProfile com perfil anthropic nativo não altera o ambiente (criterio 6)", () => {
  const base = { ANTHROPIC_API_KEY: "subscription-key", PATH: "/usr/bin" };
  const profile = defaultLlmProfiles().find((p) => p.id === "anthropic");
  assert.ok(profile);
  const env = applyProfile(base, profile);
  assert.deepEqual(env, base);
});

test("applyProfile aplica extraEnv também em perfil nativo sem baseUrl", () => {
  const profile = defaultLlmProfiles().find((p) => p.id === "anthropic");
  assert.ok(profile);
  const env = applyProfile(
    { ANTHROPIC_API_KEY: "subscription-key" },
    { ...profile, extraEnv: "CLAUDE_CODE_EFFORT_LEVEL=max" },
  );
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, "max");
  assert.equal(env.ANTHROPIC_API_KEY, "subscription-key");
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
});

test("parseExtraEnv ignora vazios, comentários e chaves inválidas", () => {
  const entries = parseExtraEnv(
    "\n# comentário\nFOO=bar\n  SPACED = a=b=c \n=semchave\nINVALIDA CHAVE=x\n1NUM=x\nVAZIA=\n",
  );
  assert.deepEqual(entries, [
    ["FOO", "bar"],
    ["SPACED", "a=b=c"],
    ["VAZIA", ""],
  ]);
});

test("sanitizeProfile preserva extraEnv e degrada para vazio em settings antigos", () => {
  const withExtra = sanitizeProfile({ id: "x", extraEnv: " A=1 " }, "fb");
  assert.equal(withExtra?.extraEnv, "A=1");
  const legacy = sanitizeProfile({ id: "x", label: "X" }, "fb");
  assert.equal(legacy?.extraEnv, "");
});

test("seedMissingDefaultProfiles acrescenta o kimi em instalações antigas sem sobrescrever perfis", () => {
  const persisted = defaultLlmProfiles().filter((p) => p.id !== "kimi");
  persisted[0].label = "Custom Anthropic";
  const result = seedMissingDefaultProfiles(persisted, []);
  assert.equal(result.changed, true);
  assert.ok(result.profiles.some((p) => p.id === "kimi"));
  assert.equal(result.profiles.find((p) => p.id === "anthropic")?.label, "Custom Anthropic");
  assert.deepEqual([...result.seededIds].sort(), defaultLlmProfiles().map((p) => p.id).sort());
});

test("seedMissingDefaultProfiles não ressuscita perfil padrão apagado pelo usuário", () => {
  const allIds = defaultLlmProfiles().map((p) => p.id);
  const withoutKimi = defaultLlmProfiles().filter((p) => p.id !== "kimi");
  const result = seedMissingDefaultProfiles(withoutKimi, allIds);
  assert.equal(result.changed, false);
  assert.equal(result.profiles.some((p) => p.id === "kimi"), false);
});

test("seedMissingDefaultProfiles preserva perfil customizado que reutiliza o id kimi", () => {
  const custom = defaultLlmProfiles().filter((p) => p.id !== "kimi");
  const customKimi = { ...kimiProfile(), label: "Meu Kimi", opusModel: "kimi-k3" };
  custom.push(customKimi);
  const result = seedMissingDefaultProfiles(custom, []);
  assert.equal(result.profiles.filter((p) => p.id === "kimi").length, 1);
  assert.equal(result.profiles.find((p) => p.id === "kimi")?.label, "Meu Kimi");
});

test("perfis do gateway continuam usando a virtual key do Bifrost", () => {
  for (const id of ["zai", "openai", "sakana"]) {
    const profile = defaultLlmProfiles().find((p) => p.id === id);
    assert.equal(profile?.tokenEnv, GATEWAY_TOKEN_ENV);
  }
});
