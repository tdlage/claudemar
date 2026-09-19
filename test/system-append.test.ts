import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = resolve(import.meta.dirname, "../../.output/isolation-validation/data");
process.env.BRAIN_ROOT = resolve(process.env.CLAUDEMAR_DATA, "brain");
const { buildSystemAppend } = await import("../src/runtime/system-append.js");

for (const targetType of ["project", "agent", "orchestrator"]) {
  test(`omits only isolation and restores it by default for ${targetType}`, () => {
    const params = { cwd: process.env.CLAUDEMAR_DATA!, target: { targetType, targetName: "test" }, systemAppend: "Instruções adicionais" };
    const normal = buildSystemAppend(params);
    const omitted = buildSystemAppend({ ...params, skipIsolationInstruction: true });
    assert.match(normal, /Você está confinado ao diretório/);
    assert.doesNotMatch(omitted, /Você está confinado ao diretório/);
    assert.equal(omitted, normal.split("\n\n").slice(1).join("\n\n"));
    assert.equal(buildSystemAppend({ ...params, skipIsolationInstruction: false }), normal);
    assert.match(omitted, /Instruções adicionais/);
  });
}
