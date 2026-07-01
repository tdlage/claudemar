import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  getModelDisplayName,
  isSelectableProjectModel,
  resolveExecutionModel,
  DEFAULT_PROJECT_MODEL,
  PROJECT_SELECTABLE_MODELS,
} from "../src/models-discovery.js";

test("getModelDisplayName resolve Fable 5 pelo id", () => {
  assert.equal(getModelDisplayName("claude-fable-5"), "Fable 5");
});

test("getModelDisplayName mantém Opus 4.8 e alias opus", () => {
  assert.equal(getModelDisplayName("claude-opus-4-8"), "Opus 4.8");
  assert.equal(getModelDisplayName("opus"), "Opus 4.8");
});

test("PROJECT_SELECTABLE_MODELS oferece exatamente Opus e Fable", () => {
  assert.deepEqual(
    PROJECT_SELECTABLE_MODELS.map((m) => m.model),
    ["opus", "claude-fable-5"],
  );
});

test("isSelectableProjectModel aceita apenas os modelos suportados", () => {
  assert.equal(isSelectableProjectModel("opus"), true);
  assert.equal(isSelectableProjectModel("claude-fable-5"), true);
  assert.equal(isSelectableProjectModel("claude-sonnet-4-6"), false);
  assert.equal(isSelectableProjectModel(""), false);
  assert.equal(isSelectableProjectModel(undefined), false);
  assert.equal(isSelectableProjectModel(42), false);
});

test("resolveExecutionModel: projeto + anthropic + fable → claude-fable-5", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProviderId: "anthropic",
      projectModel: "claude-fable-5",
    }),
    "claude-fable-5",
  );
});

test("resolveExecutionModel: projeto sem preferência mantém o default (opus)", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProviderId: "anthropic",
      projectModel: DEFAULT_PROJECT_MODEL,
    }),
    "opus",
  );
});

test("resolveExecutionModel: provider gateway ignora a preferência do projeto", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProviderId: "zai",
      projectModel: "claude-fable-5",
    }),
    "opus",
  );
});

test("resolveExecutionModel: alvos não-projeto usam o default", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "agent",
      activeProviderId: "anthropic",
      projectModel: "claude-fable-5",
    }),
    "opus",
  );
});

test("resolveExecutionModel: override explícito sempre prevalece", () => {
  assert.equal(
    resolveExecutionModel({
      explicitModel: "claude-sonnet-4-6",
      targetType: "project",
      activeProviderId: "zai",
      projectModel: "claude-fable-5",
    }),
    "claude-sonnet-4-6",
  );
});
