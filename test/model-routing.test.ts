import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultLlmProfiles, applyProfile } from "../src/providers/llm.js";
import { modelsForProfiles, modelSelection, resolveModelSelection } from "../src/model-routing.js";

const profiles = defaultLlmProfiles();

test("catalog includes models from every provider with explicit runtime and identity", () => {
  const models = modelsForProfiles(profiles);
  assert.deepEqual(new Set(models.map((m) => m.providerId)), new Set(profiles.map((p) => p.id)));
  assert.ok(models.some((m) => m.modelId === "gpt-6-astra" && m.runtime === "codex"));
  assert.ok(models.some((m) => m.modelId === "claude-sonnet-4-6" && m.runtime === "claude"));
  assert.ok(models.some((m) => m.modelId === "glm-5.3-flash" && m.runtime === "claude"));
  assert.equal(new Set(models.map((m) => m.model)).size, models.length);
});

test("selection routes using the provider even when model names overlap or look like another runtime", () => {
  const first = { ...profiles[1], id: "custom-a", opusModel: "gpt-custom", sonnetModel: "gpt-custom", haikuModel: "gpt-custom" };
  const second = { ...first, id: "custom-b", runtime: "codex" as const };
  const custom = [first, second];
  assert.equal(resolveModelSelection(modelSelection(first.id, first.opusModel), custom).profile.runtime, "claude");
  assert.equal(resolveModelSelection(modelSelection(second.id, second.opusModel), custom).profile.runtime, "codex");
  assert.throws(() => resolveModelSelection("gpt-custom", custom), /ambíguo/);
  assert.throws(() => resolveModelSelection("unknown::gpt-custom", custom), /indisponível/);
  assert.throws(() => resolveModelSelection("custom-a::missing", custom), /indisponível/);
});

test("legacy model ids resolve without choosing a global provider", () => {
  assert.equal(resolveModelSelection("gpt-6-astra", profiles).profile.id, "codex");
  assert.equal(resolveModelSelection("claude-opus-5", profiles).profile.id, "anthropic");
  assert.equal(resolveModelSelection("k3", profiles).profile.id, "kimi");
});

test("per-execution profile and credentials remain independent", () => {
  const kimi = resolveModelSelection("kimi::k3", profiles);
  const zai = resolveModelSelection("zai::glm-5.3", profiles);
  const base = { KIMI_API_KEY: "kimi-token", ZAI_API_KEY: "zai-token", ANTHROPIC_AUTH_TOKEN: "native-token" };
  const first = applyProfile(base, kimi.profile);
  const second = applyProfile(base, zai.profile);
  assert.equal(first.ANTHROPIC_AUTH_TOKEN, "kimi-token");
  assert.equal(second.ANTHROPIC_AUTH_TOKEN, "zai-token");
  assert.notEqual(first.ANTHROPIC_BASE_URL, second.ANTHROPIC_BASE_URL);
  assert.equal(base.ANTHROPIC_AUTH_TOKEN, "native-token");
  kimi.profile.opusModel = "changed";
  assert.equal(profiles[1].opusModel, "k3");
});
