import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { ProjectSettingsManager } = await import("../src/project-settings.js");

const codexProfile = {
  id: "codex",
  label: "OpenAI (ChatGPT)",
  runtime: "codex" as const,
  baseUrl: "",
  tokenEnv: "",
  opusModel: "gpt-5.6-sol",
  sonnetModel: "gpt-5.6-sol",
  haikuModel: "gpt-5.6-luna",
  timeoutMs: "",
  autoCompactWindow: "",
  extraEnv: "",
};

function freshStore() {
  const dir = mkdtempSync(resolve(tmpdir(), "claudemar-ps-"));
  const file = resolve(dir, "project-settings.json");
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("getModel retorna o default para projeto sem preferência", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    assert.equal(mgr.getModel("qualquer"), "claude-opus-5");
  } finally {
    cleanup();
  }
});

test("setModel/getModel persistem a escolha e sobrevivem a nova instância", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5-1");
    mgr.flush();

    const reloaded = new ProjectSettingsManager(file);
    assert.equal(reloaded.getModel("proj-a"), "claude-fable-5-1");
  } finally {
    cleanup();
  }
});

test("voltar ao default remove a entrada persistida", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5-1");
    mgr.setModel("proj-a", "claude-opus-5");
    mgr.flush();

    const reloaded = new ProjectSettingsManager(file);
    assert.equal(reloaded.getModel("proj-a"), "claude-opus-5");
  } finally {
    cleanup();
  }
});

test("a preferência de um projeto não afeta outro", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5-1");
    assert.equal(mgr.getModel("proj-a"), "claude-fable-5-1");
    assert.equal(mgr.getModel("proj-b"), "claude-opus-5");
    mgr.flush();
  } finally {
    cleanup();
  }
});

test("setModel rejeita valores fora do catálogo", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    assert.throws(() => mgr.setModel("proj-a", "claude-sonnet-4-6"));
    assert.equal(mgr.getModel("proj-a"), "claude-opus-5");
  } finally {
    cleanup();
  }
});

test("mantém escolhas independentes para Anthropic e OpenAI", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5-1");
    mgr.setModel("proj-a", "gpt-5.6-luna", codexProfile);
    mgr.flush();

    const reloaded = new ProjectSettingsManager(file);
    assert.equal(reloaded.getModel("proj-a"), "claude-fable-5-1");
    assert.equal(reloaded.getModel("proj-a", codexProfile), "gpt-5.6-luna");
  } finally {
    cleanup();
  }
});

test("OpenAI aceita apenas modelos do catálogo do perfil ativo", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    assert.throws(() => mgr.setModel("proj-a", "gpt-4o", codexProfile));
    mgr.setModel("proj-a", "gpt-6-astra", codexProfile);
    assert.equal(mgr.getModel("proj-a", codexProfile), "gpt-6-astra");
    mgr.flush();
  } finally {
    cleanup();
  }
});
