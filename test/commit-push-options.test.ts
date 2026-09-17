import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildOptions } from "../src/claude/options.js";
import { COMMIT_PUSH_MODEL, defaultLlmProfiles } from "../src/providers/llm.js";
import { resolveModelSelection } from "../src/model-routing.js";

test("commit/push is pinned to z.ai Flash regardless of other providers' model names", () => {
  const profiles = defaultLlmProfiles();
  profiles.unshift({ ...profiles[1], id: "other", opusModel: "glm-5.3-flash" });
  const selected = resolveModelSelection(COMMIT_PUSH_MODEL, profiles);
  assert.equal(selected.profile.id, "zai");
  assert.equal(selected.profile.runtime, "claude");
  assert.equal(selected.model, "glm-5.3-flash");
  assert.throws(() => resolveModelSelection(COMMIT_PUSH_MODEL, profiles.filter((profile) => profile.id !== "zai")), /indisponível/);
});

test("ordinary Claude executions keep project context and their selected effort", () => {
  const options = buildOptions({
    profile: defaultLlmProfiles()[0],
    cwd: process.cwd(),
    target: { targetType: "project", targetName: "app" },
    effort: "max",
    abortController: new AbortController(),
    canUseTool: async (_tool, input) => ({ behavior: "allow", updatedInput: input }),
  });
  assert.deepEqual(options.settingSources, ["project"]);
  assert.equal(options.effort, "max");
  assert.equal(options.thinking, undefined);
  assert.equal(options.maxTurns, undefined);
  assert.equal(options.enableFileCheckpointing, true);
});
