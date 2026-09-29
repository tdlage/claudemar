import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canAccessRunConfig, runConfigView } from "../src/server/run-config-access.js";
import type { RequestContext } from "../src/server/middleware.js";

const config = { id: "c1", name: "api", command: "npm start", workingDirectory: "/srv", envVars: { TOKEN: "x" }, projectName: "alpha" };
const user: RequestContext = { role: "user", userId: "u1", name: "ana", projects: ["alpha"], agents: [], projectTabs: {} };

test("users reach only run configs of their projects", () => {
  assert.equal(canAccessRunConfig(user, config), true);
  assert.equal(canAccessRunConfig(user, { ...config, projectName: "beta" }), false);
  assert.equal(canAccessRunConfig(user, { ...config, projectName: "" }), false);
  assert.equal(canAccessRunConfig({ role: "admin" }, { ...config, projectName: "" }), true);
});

test("users never receive command, directory or environment variables", () => {
  const view = runConfigView(user, config, { running: true, pid: 42, startedAt: "2026-09-29T10:00:00Z" });
  assert.deepEqual(Object.keys(view).sort(), ["id", "name", "projectName", "proxyDomain", "proxyPort", "status"]);
  assert.deepEqual(view.status, { running: true, startedAt: "2026-09-29T10:00:00Z" });
});
