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
  isNativeAnthropic,
  parseExtraEnv,
  migrateLegacyProfiles,
  sanitizeProfile,
  seedMissingDefaultProfiles,
} = await import("../src/providers/llm.js");

const LEGACY_GATEWAY_URL = "http://localhost:8080/anthropic";

function kimiProfile() {
  const profile = defaultLlmProfiles().find((p) => p.id === "kimi");
  assert.ok(profile, "perfil kimi deve existir nos defaults");
  return profile;
}

function codexProfile() {
  const profile = defaultLlmProfiles().find((p) => p.id === "codex");
  assert.ok(profile, "perfil codex deve existir nos defaults");
  return profile;
}

test("defaults trazem apenas perfis sem gateway, cada um com seu runtime", () => {
  const ids = defaultLlmProfiles().map((p) => p.id);
  assert.deepEqual(ids, ["anthropic", "kimi", "zai", "codex"]);
  for (const p of defaultLlmProfiles()) {
    assert.equal(p.runtime, p.id === "codex" ? "codex" : "claude");
  }
});

test("perfil kimi default aponta para o endpoint Anthropic-compatível do Kimi Code", () => {
  const profile = kimiProfile();
  assert.equal(profile.label, "Kimi (K3)");
  assert.equal(profile.baseUrl, "https://api.kimi.com/coding");
  assert.equal(profile.tokenEnv, "KIMI_API_KEY");
  assert.equal(profile.opusModel, "k3");
  assert.equal(profile.sonnetModel, "k3");
  assert.equal(profile.haikuModel, "k3");
  assert.equal(profile.autoCompactWindow, "1048576");
});

test("perfil codex default usa a assinatura do ChatGPT (sem baseUrl nem token)", () => {
  const profile = codexProfile();
  assert.equal(profile.runtime, "codex");
  assert.equal(profile.label, "OpenAI (ChatGPT)");
  assert.equal(profile.baseUrl, "");
  assert.equal(profile.tokenEnv, "");
  assert.equal(profile.opusModel, "gpt-5.6-sol");
  assert.equal(profile.haikuModel, "gpt-5.6-luna");
  assert.equal(isNativeAnthropic(profile), false);
});

test("isNativeAnthropic só vale para runtime claude sem baseUrl", () => {
  const anthropic = defaultLlmProfiles().find((p) => p.id === "anthropic");
  assert.ok(anthropic);
  assert.equal(isNativeAnthropic(anthropic), true);
  assert.equal(isNativeAnthropic(kimiProfile()), false);
  assert.equal(isNativeAnthropic({ ...anthropic, runtime: "codex" }), false);
});

test("migrateLegacyProfiles reescreve o perfil kimi ainda apontando para a Moonshot", () => {
  const legacy = { ...kimiProfile(), baseUrl: "https://api.moonshot.ai/anthropic", opusModel: "kimi-k3[1m]", label: "Meu Kimi" };
  const { profiles, changed } = migrateLegacyProfiles([legacy]);
  assert.equal(changed, true);
  assert.equal(profiles[0].baseUrl, "https://api.kimi.com/coding");
  assert.equal(profiles[0].opusModel, "k3");
  assert.equal(profiles[0].label, "Meu Kimi");
});

test("migrateLegacyProfiles preserva perfil kimi já migrado ou customizado para outro endpoint", () => {
  const current = kimiProfile();
  const custom = { ...current, baseUrl: "https://proxy.interno/anthropic" };
  const { profiles, changed } = migrateLegacyProfiles([current, custom]);
  assert.equal(changed, false);
  assert.equal(profiles[0].baseUrl, "https://api.kimi.com/coding");
  assert.equal(profiles[1].baseUrl, "https://proxy.interno/anthropic");
});

test("migrateLegacyProfiles converte o perfil codex do proxy local para o runtime nativo", () => {
  const legacy = { ...codexProfile(), runtime: "claude" as const, baseUrl: "http://127.0.0.1:18765", label: "Meu Codex", extraEnv: "CLAUDE_CODE_SUBAGENT_MODEL=gpt-5.6-luna" };
  const { profiles, changed } = migrateLegacyProfiles([legacy]);
  assert.equal(changed, true);
  assert.equal(profiles[0].runtime, "codex");
  assert.equal(profiles[0].baseUrl, "");
  assert.equal(profiles[0].extraEnv, "");
  assert.equal(profiles[0].label, "Meu Codex");
});

test("migrateLegacyProfiles remove os perfis openai e sakana que dependiam do gateway", () => {
  const base = defaultLlmProfiles();
  const openai = { ...base[0], id: "openai", label: "OpenAI (GPT)", baseUrl: LEGACY_GATEWAY_URL, tokenEnv: "BIFROST_VIRTUAL_KEY", opusModel: "openai/gpt-5.5" };
  const sakana = { ...base[0], id: "sakana", label: "Sakana", baseUrl: "http://bifrost:8080/anthropic", tokenEnv: "BIFROST_VIRTUAL_KEY", opusModel: "sakana/fugu" };
  const { profiles, changed } = migrateLegacyProfiles([...base, openai, sakana]);
  assert.equal(changed, true);
  assert.deepEqual(profiles.map((p) => p.id), base.map((p) => p.id));
});

test("migrateLegacyProfiles preserva perfil openai customizado fora do gateway", () => {
  const custom = { ...codexProfile(), id: "openai", baseUrl: "https://proxy.interno/v1", tokenEnv: "MY_KEY" };
  const { profiles, changed } = migrateLegacyProfiles([custom]);
  assert.equal(changed, false);
  assert.equal(profiles.length, 1);
});

test("applyProfile com kimi configura o ambiente da execução (criterios 1 e 2)", () => {
  process.env.KIMI_API_KEY = "sk-kimi-test";
  try {
    const env = applyProfile({ ANTHROPIC_API_KEY: "subscription-key" }, kimiProfile());
    assert.equal(env.ANTHROPIC_BASE_URL, "https://api.kimi.com/coding");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk-kimi-test");
    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "k3");
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "k3");
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "k3");
    assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "1048576");
    assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, "k3");
    assert.equal(env.ENABLE_TOOL_SEARCH, "false");
    assert.equal("ANTHROPIC_API_KEY" in env, false);
  } finally {
    delete process.env.KIMI_API_KEY;
  }
});

test("applyProfile sem token configurado não inventa credencial", () => {
  delete process.env.KIMI_API_KEY;
  const env = applyProfile({ ANTHROPIC_API_KEY: "subscription-key" }, kimiProfile());
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.kimi.com/coding");
  assert.equal("ANTHROPIC_AUTH_TOKEN" in env, false);
  assert.equal("ANTHROPIC_API_KEY" in env, false);
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

test("sanitizeProfile assume runtime claude em settings antigos e preserva codex", () => {
  assert.equal(sanitizeProfile({ id: "x" }, "fb")?.runtime, "claude");
  assert.equal(sanitizeProfile({ id: "x", runtime: "codex" }, "fb")?.runtime, "codex");
  assert.equal(sanitizeProfile({ id: "x", runtime: "outro" }, "fb")?.runtime, "claude");
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

function zaiProfile() {
  const profile = defaultLlmProfiles().find((p) => p.id === "zai");
  assert.ok(profile, "perfil zai deve existir nos defaults");
  return profile;
}

test("perfil zai default conecta direto ao endpoint de coding da z.ai", () => {
  const profile = zaiProfile();
  assert.equal(profile.baseUrl, "https://api.z.ai/api/anthropic");
  assert.equal(profile.tokenEnv, "ZAI_API_KEY");
  assert.equal(profile.opusModel, "glm-5.3");
  assert.equal(profile.sonnetModel, "glm-5.3");
  assert.equal(profile.haikuModel, "glm-5.3-flash");
  assert.equal(profile.autoCompactWindow, "1000000");
});

test("migrateLegacyProfiles reescreve o perfil zai ainda roteado pelo gateway", () => {
  const legacy = { ...zaiProfile(), baseUrl: LEGACY_GATEWAY_URL, tokenEnv: "BIFROST_VIRTUAL_KEY", opusModel: "zai/glm-5.2", label: "Meu GLM" };
  const { profiles, changed } = migrateLegacyProfiles([legacy]);
  assert.equal(changed, true);
  assert.equal(profiles[0].baseUrl, "https://api.z.ai/api/anthropic");
  assert.equal(profiles[0].tokenEnv, "ZAI_API_KEY");
  assert.equal(profiles[0].opusModel, "glm-5.3");
  assert.equal(profiles[0].label, "Meu GLM");
});

test("migrateLegacyProfiles preserva perfil zai já migrado ou customizado", () => {
  const current = zaiProfile();
  const custom = { ...current, baseUrl: "https://proxy.interno/anthropic" };
  const { profiles, changed } = migrateLegacyProfiles([current, custom]);
  assert.equal(changed, false);
  assert.equal(profiles[0].baseUrl, "https://api.z.ai/api/anthropic");
  assert.equal(profiles[1].baseUrl, "https://proxy.interno/anthropic");
});
