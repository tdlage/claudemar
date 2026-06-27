import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  autoApprovesTool,
  decideImmediatePermission,
  resolveBypass,
} from "../src/claude/permission.js";

test("pipeline força bypass mesmo sem autoApprove (criterio 3)", () => {
  assert.equal(resolveBypass({ source: "pipeline" }), true);
});

test("pipeline com autoApprove explícito permanece em bypass", () => {
  assert.equal(resolveBypass({ source: "pipeline", autoApprove: true }), true);
});

test("planMode tem precedência e desliga bypass mesmo no pipeline", () => {
  assert.equal(resolveBypass({ source: "pipeline", planMode: true }), false);
});

test("web sem autoApprove continua interativo (criterio 6)", () => {
  assert.equal(resolveBypass({ source: "web" }), false);
});

test("web com autoApprove entra em bypass", () => {
  assert.equal(resolveBypass({ source: "web", autoApprove: true }), true);
});

test("web com permissionMode bypassPermissions entra em bypass", () => {
  assert.equal(resolveBypass({ source: "web", permissionMode: "bypassPermissions" }), true);
});

test("telegram (não-web) é não-interativo e entra em bypass", () => {
  assert.equal(resolveBypass({ source: "telegram" }), true);
});

test("schedule é desassistido e entra em bypass", () => {
  assert.equal(resolveBypass({ source: "schedule" }), true);
});

test("bypass auto-aprova qualquer ferramenta (criterios 1 e 2)", () => {
  for (const tool of ["Bash", "Edit", "Write", "mcp__pipeline__report_plan", "Read"]) {
    assert.equal(autoApprovesTool(tool, true, "default"), true, `esperava allow para ${tool}`);
  }
});

test("acceptEdits só auto-aprova ferramentas de edição", () => {
  assert.equal(autoApprovesTool("Edit", false, "acceptEdits"), true);
  assert.equal(autoApprovesTool("Bash", false, "acceptEdits"), false);
});

test("default sem bypass não auto-aprova", () => {
  assert.equal(autoApprovesTool("Bash", false, "default"), false);
});

test("em bypass, Bash é resolvido imediatamente com allow (criterios 1 e 2)", () => {
  const result = decideImmediatePermission(
    "Bash",
    { command: "git status" },
    { bypass: true, currentPermissionMode: "bypassPermissions", isSubagentAllowed: null },
  );
  assert.deepEqual(result, { behavior: "allow", updatedInput: { command: "git status" } });
});

test("AskUserQuestion é negada imediatamente sem ficar pendente (criterio 5)", () => {
  const result = decideImmediatePermission(
    "AskUserQuestion",
    { questions: [] },
    { bypass: true, currentPermissionMode: "bypassPermissions", isSubagentAllowed: null },
  );
  assert.equal(result?.behavior, "deny");
});

test("sem bypass e sem acceptEdits, decisão é adiada (null = pedir a humano, criterio 6)", () => {
  const result = decideImmediatePermission(
    "Bash",
    { command: "rm -rf /" },
    { bypass: false, currentPermissionMode: "default", isSubagentAllowed: null },
  );
  assert.equal(result, null);
});

test("subagente fora do time é negado mesmo em bypass", () => {
  const result = decideImmediatePermission(
    "Agent",
    { subagent_type: "estranho" },
    { bypass: true, currentPermissionMode: "bypassPermissions", isSubagentAllowed: (t) => t === "amigo" },
  );
  assert.equal(result?.behavior, "deny");
});
