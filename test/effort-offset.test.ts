import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyEffortOffset } from "../src/jev/effort-offset.js";

test("raising the automatic effort climbs one level and tops out per runtime", () => {
  assert.equal(applyEffortOffset("claude", "high", 1), "extra");
  assert.equal(applyEffortOffset("claude", "extra", 1), "max");
  assert.equal(applyEffortOffset("claude", "max", 1), "ultracode");
  assert.equal(applyEffortOffset("claude", "ultracode", 1), "ultracode");
  assert.equal(applyEffortOffset("codex", "max", 1), "max");
});

test("lowering the automatic effort drops one level and never goes below low", () => {
  assert.equal(applyEffortOffset("claude", "max", -1), "extra");
  assert.equal(applyEffortOffset("codex", "medium", -1), "low");
  assert.equal(applyEffortOffset("claude", "low", -1), "low");
});

test("a neutral offset keeps the recommended effort", () => {
  assert.equal(applyEffortOffset("claude", "medium", 0), "medium");
  assert.equal(applyEffortOffset("codex", "extra", 0), "extra");
});
