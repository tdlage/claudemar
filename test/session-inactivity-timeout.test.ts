import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
const outputDir = resolve(import.meta.dirname, "../../.output/session-inactivity");
mkdirSync(outputDir, { recursive: true });
const dataDir = mkdtempSync(resolve(outputDir, "data-"));
process.env.CLAUDEMAR_DATA = dataDir;

test("sessionInactivityTimeoutMs não interrompe sessões silenciosas por padrão", async () => {
  delete process.env.SESSION_INACTIVITY_TIMEOUT_MS;
  const { config } = await import(`../src/config.js?${Date.now()}`);
  assert.equal(config.sessionInactivityTimeoutMs, 0);
});

test("sessionInactivityTimeoutMs respeita a env var", async () => {
  process.env.SESSION_INACTIVITY_TIMEOUT_MS = "30000";
  const { config } = await import(`../src/config.js?${Date.now()}`);
  assert.equal(config.sessionInactivityTimeoutMs, 30000);
  delete process.env.SESSION_INACTIVITY_TIMEOUT_MS;
});

test("sessionInactivityTimeoutMs 0 desliga o watchdog", async () => {
  process.env.SESSION_INACTIVITY_TIMEOUT_MS = "0";
  const { config } = await import(`../src/config.js?${Date.now()}`);
  assert.equal(config.sessionInactivityTimeoutMs, 0);
  delete process.env.SESSION_INACTIVITY_TIMEOUT_MS;
});

process.on("exit", () => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch { /* noop */ }
});

test("background tasks have no implicit timeout and still accept an explicit limit", async () => {
  const previous = process.env.PENDING_TASKS_GRACE_MS;
  try {
    delete process.env.PENDING_TASKS_GRACE_MS;
    const defaults = await import("../src/config.js?pending-default");
    assert.equal(defaults.config.pendingTasksGraceMs, 0);
    process.env.PENDING_TASKS_GRACE_MS = "30000";
    const configured = await import("../src/config.js?pending-configured");
    assert.equal(configured.config.pendingTasksGraceMs, 30000);
  } finally {
    if (previous === undefined) delete process.env.PENDING_TASKS_GRACE_MS;
    else process.env.PENDING_TASKS_GRACE_MS = previous;
  }
});
