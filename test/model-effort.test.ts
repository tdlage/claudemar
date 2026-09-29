import { strict as assert } from "node:assert";
import { test } from "node:test";
import { effortForModel } from "../src/model-effort.js";

test("Sonnet runs with at least extra high effort", () => {
  assert.equal(effortForModel("claude-sonnet-5-5", "low"), "extra");
  assert.equal(effortForModel("claude-sonnet-5-5", "high"), "extra");
  assert.equal(effortForModel("claude-sonnet-5-5", undefined), "extra");
  assert.equal(effortForModel("claude-sonnet-5-5", "max"), "max");
  assert.equal(effortForModel("claude-sonnet-5-5", "ultracode"), "ultracode");
});

test("other models keep the requested effort", () => {
  assert.equal(effortForModel("claude-opus-5-5", "low"), "low");
  assert.equal(effortForModel("gpt-6-astra", undefined), undefined);
});
