import { strict as assert } from "node:assert";
import { test } from "node:test";
import { latestModelActivity, modelFromActivity, type ModelActivity } from "../src/activity-model.js";
import { modelsForProfiles } from "../src/model-routing.js";
import { defaultLlmProfiles } from "../src/providers/llm.js";

const models = modelsForProfiles(defaultLlmProfiles());
const base: ModelActivity = { id: "last", targetType: "project", targetName: "app", startedAt: "2026-09-10T12:00:00Z" };

test("uses the latest Activity for this target, including active executions", () => {
  const older = { ...base, id: "older", startedAt: "2026-09-09T12:00:00Z", model: "claude-opus-5" };
  const latest = { ...base, model: "gpt-5.6-sol", runtime: "codex" as const };
  const other = { ...latest, id: "other", targetType: "agent", startedAt: "2026-09-11T12:00:00Z" };
  assert.equal(latestModelActivity([older, other, latest], "project", "app"), latest);
  assert.equal(modelFromActivity(latest, models, "claude"), "codex::gpt-5.6-sol");
});

test("keeps the exact model instead of replacing it with a runtime default", () => {
  assert.equal(modelFromActivity({ ...base, model: "claude-fable-5-1", runtime: "claude" }, models, "codex"), "anthropic::claude-fable-5-1");
  assert.equal(modelFromActivity({ ...base, model: "k3", runtime: "claude" }, models, "codex"), "kimi::k3");
});

test("uses session metadata to distinguish providers with the same model", () => {
  const profiles = defaultLlmProfiles();
  const duplicate = { ...profiles[1], id: "second-kimi" };
  const catalog = modelsForProfiles([...profiles, duplicate]);
  assert.equal(modelFromActivity({ ...base, model: "k3", runtime: "claude", modelSelection: "second-kimi::k3" }, catalog, "claude"), "second-kimi::k3");
});

test("missing or unknown exact models fall back to Opus for Claude and Astra for Codex", () => {
  for (const model of [undefined, "auto", "unknown-model"]) {
    assert.equal(modelFromActivity({ ...base, model, runtime: "claude" }, models, "codex"), "anthropic::claude-opus-5");
    assert.equal(modelFromActivity({ ...base, model, runtime: "codex" }, models, "claude"), "codex::gpt-6-astra");
  }
  assert.equal(modelFromActivity(undefined, models, "codex"), "codex::gpt-6-astra");
  assert.equal(modelFromActivity(undefined, models, "claude"), "anthropic::claude-opus-5");
});

test("uses an exact stored selection when the model field is missing", () => {
  assert.equal(modelFromActivity({ ...base, runtime: "codex", modelSelection: "codex::gpt-5.6-luna" }, models, "claude"), "codex::gpt-5.6-luna");
});


test("legacy Codex records without an exact version default to Astra", () => {
  assert.equal(modelFromActivity({ ...base, model: "codex" }, models, "claude"), "codex::gpt-6-astra");
});
