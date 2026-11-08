import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const data = mkdtempSync(resolve(tmpdir(), "claudemar-drive-targets-"));
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = data;

const { config } = await import("../src/config.js");
const { driveInputRoot, driveTargetPaths, isDriveMirrorPath } = await import("../src/google-drive/paths.js");
const { driveTargetOf, targetKey } = await import("../src/google-drive/store.js");

after(() => rmSync(data, { recursive: true, force: true }));

test("agent folders mirror into input/google-drive and spill over to output", () => {
  const paths = driveTargetPaths({ type: "agent", name: "helper" });
  assert.deepEqual(paths, {
    root: resolve(config.agentsPath, "helper"),
    input: resolve(config.agentsPath, "helper/input"),
    output: resolve(config.agentsPath, "helper/output"),
    inputLabel: "input",
    outputLabel: "output",
  });
  assert.equal(driveInputRoot({ type: "agent", name: "helper" }), resolve(config.agentsPath, "helper/input/google-drive"));
});

test("project folders mirror into .input/google-drive and spill over to .output", () => {
  const paths = driveTargetPaths({ type: "project", name: "site" });
  assert.deepEqual(paths, {
    root: resolve(config.projectsPath, "site"),
    input: resolve(config.projectsPath, "site/.input"),
    output: resolve(config.projectsPath, "site/.output"),
    inputLabel: ".input",
    outputLabel: ".output",
  });
  assert.equal(driveInputRoot({ type: "project", name: "site" }), resolve(config.projectsPath, "site/.input/google-drive"));
});

test("invalid target names never resolve to a path", () => {
  assert.equal(driveTargetPaths({ type: "project", name: "../escape" }), null);
  assert.equal(driveTargetPaths({ type: "agent", name: "../escape" }), null);
});

test("the file watcher ignores agent and project mirrors only", () => {
  assert.equal(isDriveMirrorPath(resolve(config.agentsPath, "helper/input/google-drive/Reports/a.md")), true);
  assert.equal(isDriveMirrorPath(resolve(config.projectsPath, "site/.input/google-drive/Reports/a.md")), true);
  assert.equal(isDriveMirrorPath(resolve(config.projectsPath, "site/.input/brief.pdf")), false);
  assert.equal(isDriveMirrorPath(resolve(config.projectsPath, "site/input/google-drive/a.md")), false);
  assert.equal(isDriveMirrorPath(resolve(config.agentsPath, "helper/output/google-drive/a.md")), false);
});

test("only agent and project executions map to Drive targets", () => {
  assert.deepEqual(driveTargetOf({ targetType: "project", targetName: "site" }), { type: "project", name: "site" });
  assert.deepEqual(driveTargetOf({ targetType: "agent", targetName: "helper" }), { type: "agent", name: "helper" });
  assert.equal(driveTargetOf({ targetType: "orchestrator", targetName: "orchestrator" }), null);
  assert.notEqual(targetKey({ type: "agent", name: "x" }), targetKey({ type: "project", name: "x" }));
});
