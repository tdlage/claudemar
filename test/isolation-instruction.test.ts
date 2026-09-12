import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Request, Response } from "express";
import { validateIsolationInstruction } from "../src/server/isolation-instruction.js";

for (const role of ["admin", "user", undefined]) {
  for (const value of [undefined, false, true, "true", 1, null]) {
    test(`isolation authorization: role=${role}, value=${String(value)}`, () => {
      let status: number | undefined;
      let passed = false;
      const req = { body: { skipIsolationInstruction: value }, ctx: role ? { role } : undefined } as Request;
      const res = { status(code: number) { status = code; return this; }, json() {} } as unknown as Response;
      validateIsolationInstruction(req, res, () => { passed = true; });
      const expected = value !== undefined && typeof value !== "boolean" ? 400 : value === true && role !== "admin" ? 403 : undefined;
      assert.equal(status, expected);
      assert.equal(passed, expected === undefined);
    });
  }
}
