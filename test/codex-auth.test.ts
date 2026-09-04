import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { parseDeviceAuthOutput, parseLoginStatus, stripAnsi } = await import("../src/codex/auth.js");
const { parseCodexUsage } = await import("../src/codex/usage.js");
const { looksLikeCodexAuthError } = await import("../src/codex/codex-auth-state.js");
const { codexThreadIdFromFileName } = await import("../src/session-validator.js");

test("parseLoginStatus reconhece login ChatGPT, API key e ausência de login", () => {
  assert.deepEqual(parseLoginStatus("Logged in using ChatGPT\n", 0), { loggedIn: true, method: "chatgpt", detail: "Logged in using ChatGPT" });
  assert.equal(parseLoginStatus("Logged in using an API key", 0).method, "api");
  assert.equal(parseLoginStatus("Not logged in", 1).loggedIn, false);
  assert.equal(parseLoginStatus("", 1).loggedIn, false);
});

test("parseDeviceAuthOutput extrai URL e código do prompt colorido do codex login --device-auth", () => {
  const output =
    "\n1. Open this link in your browser and sign in to your account\n   \x1b[34mhttps://auth.openai.com/codex/device\x1b[0m\n" +
    "\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[34mABCD-EFGH\x1b[0m\n";
  assert.deepEqual(parseDeviceAuthOutput(output), { url: "https://auth.openai.com/codex/device", code: "ABCD-EFGH" });
  assert.deepEqual(parseDeviceAuthOutput("Requesting device code...\n"), { url: "", code: "" });
});

test("stripAnsi remove sequências de cor", () => {
  assert.equal(stripAnsi("\x1b[34mx\x1b[0m"), "x");
});

test("looksLikeCodexAuthError identifica falhas de autenticação", () => {
  assert.equal(looksLikeCodexAuthError("HTTP 401 Unauthorized"), true);
  assert.equal(looksLikeCodexAuthError("Not logged in. Run `codex login`."), true);
  assert.equal(looksLikeCodexAuthError("model response stream ended unexpectedly"), false);
});

test("codexThreadIdFromFileName extrai o UUID do rollout, inclusive de threads revertidas", () => {
  assert.equal(
    codexThreadIdFromFileName("rollout-2026-06-14T10-15-47-019ec646-295a-73e0-8148-c2bf0c997625.jsonl"),
    "019ec646-295a-73e0-8148-c2bf0c997625",
  );
  assert.equal(
    codexThreadIdFromFileName("rollout-2026-06-14T10-15-47-019EC646-295A-73E0-8148-C2BF0C997625_0199a213-81c0-7800-8aa1-bbab2a035a53.jsonl"),
    "019ec646-295a-73e0-8148-c2bf0c997625",
  );
  assert.equal(codexThreadIdFromFileName("history.jsonl"), null);
});

test("parseCodexUsage prioriza os limites Codex e preserva as janelas", () => {
  assert.deepEqual(parseCodexUsage({
    rateLimits: {
      primary: { usedPercent: 99, windowDurationMins: 60, resetsAt: 1 },
    },
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_730_947_200 },
        secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_731_456_000 },
      },
    },
  }), [
    { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_730_947_200 },
    { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_731_456_000 },
  ]);
});

test("parseCodexUsage aceita o snapshot legado e ignora janelas inválidas", () => {
  assert.deepEqual(parseCodexUsage({
    rateLimits: {
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: null },
      secondary: null,
    },
  }), [{ usedPercent: 42, windowDurationMins: 300, resetsAt: null }]);
  assert.deepEqual(parseCodexUsage({ rateLimits: { primary: { usedPercent: "42" } } }), []);
});
