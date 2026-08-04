import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

test("sessionInactivityTimeoutMs usa o default de 10 minutos", async () => {
  delete process.env.SESSION_INACTIVITY_TIMEOUT_MS;
  const { config } = await import(`../src/config.js?${Date.now()}`);
  assert.equal(config.sessionInactivityTimeoutMs, 10 * 60 * 1000);
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
    rmSync(process.env.CLAUDEMAR_DATA!, { recursive: true, force: true });
  } catch { /* noop */ }
});
