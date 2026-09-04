import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  getModelDisplayName,
  isSelectableProjectModel,
  normalizeModel,
  resolveExecutionModel,
  DEFAULT_PROJECT_MODEL,
  PROJECT_SELECTABLE_MODELS,
} from "../src/models-discovery.js";
import type { LlmProfile } from "../src/providers/llm.js";

function anthropicProfile(projectModel?: string): LlmProfile {
  return {
    id: "anthropic",
    label: "Anthropic",
    runtime: "claude",
    baseUrl: "",
    tokenEnv: "",
    opusModel: "",
    sonnetModel: "",
    haikuModel: "",
    timeoutMs: "",
    autoCompactWindow: "",
    extraEnv: "",
  };
}

function kimiProfile(projectModel?: string): LlmProfile {
  return {
    id: "kimi",
    runtime: "claude",
    label: "Kimi",
    baseUrl: "https://api.kimi.com/coding",
    tokenEnv: "KIMI_API_KEY",
    opusModel: "k3",
    sonnetModel: "k3",
    haikuModel: "k3",
    timeoutMs: "",
    autoCompactWindow: "1048576",
    extraEnv: "",
  };
}

test("getModelDisplayName resolve Fable 5.1 pelo id", () => {
  assert.equal(getModelDisplayName("claude-fable-5-1"), "Fable 5.1");
});

test("getModelDisplayName resolve Opus 5 e mantém o alias legado opus", () => {
  assert.equal(getModelDisplayName("claude-opus-5"), "Opus 5");
  assert.equal(getModelDisplayName("claude-opus-4-8"), "Opus 4.8");
  assert.equal(getModelDisplayName("opus"), "Opus 5");
});

test("normalizeModel mapeia os valores legados para os modelos atuais", () => {
  assert.equal(normalizeModel("opus"), "claude-opus-5");
  assert.equal(normalizeModel("claude-opus-5"), "claude-opus-5");
  assert.equal(normalizeModel("claude-fable-5"), "claude-fable-5-1");
  assert.equal(normalizeModel("claude-fable-5-1"), "claude-fable-5-1");
});

test("PROJECT_SELECTABLE_MODELS oferece exatamente Opus e Fable", () => {
  assert.deepEqual(
    PROJECT_SELECTABLE_MODELS.map((m) => m.model),
    ["claude-opus-5", "claude-fable-5-1"],
  );
});

test("isSelectableProjectModel aceita apenas os modelos suportados", () => {
  assert.equal(isSelectableProjectModel("claude-opus-5"), true);
  assert.equal(isSelectableProjectModel("claude-fable-5-1"), true);
  assert.equal(isSelectableProjectModel("claude-sonnet-4-6"), false);
  assert.equal(isSelectableProjectModel(""), false);
  assert.equal(isSelectableProjectModel(undefined), false);
  assert.equal(isSelectableProjectModel(42), false);
});

test("resolveExecutionModel: projeto + anthropic + fable → claude-fable-5-1", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProfile: anthropicProfile(),
      projectModel: "claude-fable-5-1",
    }),
    "claude-fable-5-1",
  );
});

test("resolveExecutionModel: projeto sem preferência usa o default (Opus 5)", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProfile: anthropicProfile(),
      projectModel: DEFAULT_PROJECT_MODEL,
    }),
    "claude-opus-5",
  );
});

test("resolveExecutionModel: preferência legada opus é normalizada para Opus 5", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProfile: anthropicProfile(),
      projectModel: "opus",
    }),
    "claude-opus-5",
  );
});

test("resolveExecutionModel: provider não-nativo ignora a preferência do projeto e usa o modelo do perfil", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProfile: kimiProfile(),
      projectModel: "claude-fable-5-1",
    }),
    "k3",
  );
});

test("resolveExecutionModel: alvos não-projeto usam o modelo do perfil ativo", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "agent",
      activeProfile: kimiProfile(),
      projectModel: "claude-fable-5-1",
    }),
    "k3",
  );
  assert.equal(
    resolveExecutionModel({
      targetType: "agent",
      activeProfile: anthropicProfile(),
      projectModel: "claude-fable-5-1",
    }),
    "claude-opus-5",
  );
});

test("resolveExecutionModel: override explícito sempre prevalece", () => {
  assert.equal(
    resolveExecutionModel({
      explicitModel: "claude-sonnet-4-6",
      targetType: "project",
      activeProfile: kimiProfile(),
      projectModel: "claude-fable-5-1",
    }),
    "claude-sonnet-4-6",
  );
});

function codexProfile(): LlmProfile {
  return {
    id: "codex",
    label: "OpenAI (ChatGPT)",
    runtime: "codex",
    baseUrl: "",
    tokenEnv: "",
    opusModel: "gpt-5.6-sol",
    sonnetModel: "gpt-5.6-sol",
    haikuModel: "gpt-5.6-luna",
    timeoutMs: "",
    autoCompactWindow: "",
    extraEnv: "",
  };
}

test("resolveExecutionModel: runtime codex ignora a preferência do projeto e usa o modelo principal do perfil", () => {
  assert.equal(
    resolveExecutionModel({
      targetType: "project",
      activeProfile: codexProfile(),
      projectModel: "claude-opus-5",
    }),
    "gpt-5.6-sol",
  );
});
