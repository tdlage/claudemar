import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { ProjectSettingsManager } = await import("../src/project-settings.js");

function freshStore() {
  const dir = mkdtempSync(resolve(tmpdir(), "claudemar-ps-"));
  const file = resolve(dir, "project-settings.json");
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("getModel retorna o default para projeto sem preferência", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    assert.equal(mgr.getModel("qualquer"), "opus");
  } finally {
    cleanup();
  }
});

test("setModel/getModel persistem a escolha e sobrevivem a nova instância", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5");
    mgr.flush();

    const reloaded = new ProjectSettingsManager(file);
    assert.equal(reloaded.getModel("proj-a"), "claude-fable-5");
  } finally {
    cleanup();
  }
});

test("voltar ao default remove a entrada persistida", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5");
    mgr.setModel("proj-a", "opus");
    mgr.flush();

    const reloaded = new ProjectSettingsManager(file);
    assert.equal(reloaded.getModel("proj-a"), "opus");
  } finally {
    cleanup();
  }
});

test("a preferência de um projeto não afeta outro", () => {
  const { file, cleanup } = freshStore();
  try {
    const mgr = new ProjectSettingsManager(file);
    mgr.setModel("proj-a", "claude-fable-5");
    assert.equal(mgr.getModel("proj-a"), "claude-fable-5");
    assert.equal(mgr.getModel("proj-b"), "opus");
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
    assert.equal(mgr.getModel("proj-a"), "opus");
  } finally {
    cleanup();
  }
});
