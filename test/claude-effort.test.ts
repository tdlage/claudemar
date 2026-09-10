import { strict as assert } from "node:assert";
import { test } from "node:test";
import { effortToSdk, effortToFlagLevel, isUltracode } from "../src/claude/options.js";

test("Claude Max is preserved at startup and when updating a live session", () => {
  assert.equal(effortToSdk("max"), "max");
  assert.equal(effortToFlagLevel("max"), "max");
  assert.equal(effortToFlagLevel("extra"), "xhigh");
});

test("Ultracode uses xhigh reasoning and remains distinct from Max for workflow activation", () => {
  assert.equal(effortToSdk("ultracode"), "xhigh");
  assert.equal(isUltracode("ultracode"), true);
  assert.equal(isUltracode("max"), false);
});
