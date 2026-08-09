import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-recall-test-"));

const { buildRecallLine, appendRecallLine, readRecallTail } = await import("./recall-telemetry.js");
const { ensureBrainTree, telemetryDir, brainRoot } = await import("./paths.js");

ensureBrainTree();

after(() => {
  rmSync(brainRoot, { recursive: true, force: true });
});

test("linha de recall segue exatamente o schema §13.4", () => {
  const line = buildRecallLine({
    surface: "claudemar:orchestrator",
    tool: "brain_search",
    targetName: "personal",
    query: "status do expediente do visto",
    requested: 8,
    candidatesRrf: 40,
    returnedIds: ["wiki/projects/visto-nomada-digital.md"],
    topRerankScore: 4.31,
    minRerankScore: 0.88,
    durationMs: 812,
    degraded: [],
  });
  assert.deepEqual(Object.keys(line), [
    "ts",
    "surface",
    "tool",
    "scope",
    "query",
    "requested",
    "candidates_rrf",
    "returned_ids",
    "top_rerank_score",
    "min_rerank_score",
    "duration_ms",
    "degraded",
  ]);
  assert.deepEqual(line.scope, { targetType: "brain", targetName: "personal" });
  assert.equal(line.degraded, null);

  const degraded = buildRecallLine({
    surface: "dashboard",
    tool: "dashboard_search",
    targetName: "personal,biosoft",
    query: "x",
    requested: 8,
    candidatesRrf: 0,
    returnedIds: [],
    topRerankScore: null,
    minRerankScore: null,
    durationMs: 10,
    degraded: ["dense-only", "no-rerank"],
  });
  assert.equal(degraded.degraded, "dense-only+no-rerank");
});

test("append e tail funcionam, tolerando linha corrompida", async () => {
  await appendRecallLine(
    buildRecallLine({
      surface: "dashboard",
      tool: "dashboard_search",
      targetName: "personal",
      query: "primeira",
      requested: 8,
      candidatesRrf: 12,
      returnedIds: ["wiki/people/a.md"],
      topRerankScore: 1.5,
      minRerankScore: 0.5,
      durationMs: 100,
      degraded: [],
    }),
  );
  const month = new Date().toISOString().slice(0, 7);
  appendFileSync(resolve(telemetryDir, `recall-${month}.jsonl`), "{corrompida\n");
  await appendRecallLine(
    buildRecallLine({
      surface: "dashboard",
      tool: "dashboard_search",
      targetName: "personal",
      query: "segunda",
      requested: 8,
      candidatesRrf: 5,
      returnedIds: [],
      topRerankScore: null,
      minRerankScore: null,
      durationMs: 50,
      degraded: ["no-rerank"],
    }),
  );
  const tail = await readRecallTail(undefined, 10);
  assert.equal(tail.length, 2);
  assert.equal(tail[0].query, "segunda");
  assert.equal(tail[1].query, "primeira");
});
