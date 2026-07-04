import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTimeoutMs } from "./pipeline-timeout.js";

const GLOBAL = 120 * 60 * 1000;

test("null (não configurado) usa o default global", () => {
  assert.equal(resolveTimeoutMs(null, GLOBAL), GLOBAL);
});

test("undefined (não configurado) usa o default global", () => {
  assert.equal(resolveTimeoutMs(undefined, GLOBAL), GLOBAL);
});

test("0 (desligado) permanece 0 e não colapsa no default", () => {
  assert.equal(resolveTimeoutMs(0, GLOBAL), 0);
});

test("valor explícito >0 é respeitado independente do global", () => {
  assert.equal(resolveTimeoutMs(60000, GLOBAL), 60000);
});
