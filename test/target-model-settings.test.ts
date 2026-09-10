import { strict as assert } from "node:assert";
import { test, after } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(import.meta.dirname, "../../.output");
mkdirSync(output, { recursive: true });
const root = mkdtempSync(resolve(output, "target-models-"));
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = root;
process.env.BRAIN_ROOT = resolve(root, "brain");
const { TargetModelSettings, SessionModelSettings, resolveTargetModel, targetModelSettings } = await import("../src/target-model-settings.js");
const { profileConfigured } = await import("../src/provider-catalog.js");
const { defaultLlmProfiles } = await import("../src/providers/llm.js");
after(() => rmSync(root, { recursive: true, force: true }));

test("model selection persists across restarts independently for projects and agents", () => {
  const file = resolve(root, "preferences.json");
  const store = new TargetModelSettings(file);
  store.set("project", "same", "codex::gpt-6-astra");
  store.set("agent", "same", "kimi::k3");
  const reloaded = new TargetModelSettings(file);
  assert.equal(reloaded.get("project", "same"), "codex::gpt-6-astra");
  assert.equal(reloaded.get("agent", "same"), "kimi::k3");
  reloaded.set("project", "same");
  assert.equal(new TargetModelSettings(file).get("project", "same"), undefined);
  assert.equal(new TargetModelSettings(file).get("agent", "same"), "kimi::k3");
});

test("only configured custom profiles are available and explicit selection takes precedence", () => {
  const profile = defaultLlmProfiles().find((p) => p.id === "kimi")!;
  const previous = process.env.KIMI_API_KEY;
  const zai = process.env.ZAI_API_KEY;
  try {
    delete process.env.KIMI_API_KEY;
    assert.equal(profileConfigured(profile), false);
    process.env.KIMI_API_KEY = "test";
    process.env.ZAI_API_KEY = "test-zai";
    assert.equal(profileConfigured(profile), true);
    targetModelSettings.set("agent", "worker", "kimi::k3");
    assert.equal(resolveTargetModel("agent", "worker").profile.id, "kimi");
    assert.equal(resolveTargetModel("agent", "worker", "zai::glm-5.3").profile.id, "zai");
    delete process.env.KIMI_API_KEY;
    assert.throws(() => resolveTargetModel("agent", "worker"), /indisponível/);
  } finally {
    if (previous === undefined) delete process.env.KIMI_API_KEY; else process.env.KIMI_API_KEY = previous;
    if (zai === undefined) delete process.env.ZAI_API_KEY; else process.env.ZAI_API_KEY = zai;
  }
});


test("session provider identity survives restart without overwriting another session", () => {
  const directory = resolve(root, "session-choices");
  const first = new SessionModelSettings(directory);
  const second = new SessionModelSettings(directory);
  first.set("first-session", "codex::gpt-6-astra");
  second.set("second-session", "kimi::k3");
  const reloaded = new SessionModelSettings(directory);
  assert.equal(reloaded.get("first-session"), "codex::gpt-6-astra");
  assert.equal(reloaded.get("second-session"), "kimi::k3");
});
