import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-models-admin-"));
process.env.BRAIN_USERS_ROOT = mkdtempSync(resolve(tmpdir(), "brain-models-users-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { adminBrain } = await import("./scope.js");
const { brainSettings } = await import("./settings.js");

after(() => {
  brainSettings(adminBrain()).discard();
  rmSync(process.env.BRAIN_ROOT!, { recursive: true, force: true });
  rmSync(process.env.BRAIN_USERS_ROOT!, { recursive: true, force: true });
});

test("estágios do Second Brain configurados com GLM-5.3 ou 5.3-flash passam a usar o GLM-5.4", () => {
  const system = brainSettings(adminBrain()).updateSystem({
    llm: {
      triage: { providerId: "zai", model: "glm-5.3-flash" },
      compile: { providerId: "zai", model: "glm-5.3" },
      chat: { providerId: "anthropic", model: "claude-sonnet-5-5" },
    },
  });
  assert.deepEqual(system.llm.triage, { providerId: "zai", model: "glm-5.4" });
  assert.deepEqual(system.llm.compile, { providerId: "zai", model: "glm-5.4" });
  assert.deepEqual(system.llm.chat, { providerId: "anthropic", model: "claude-sonnet-5-5" });
});
