import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT = mkdtempSync(resolve(tmpdir(), "brain-digest-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { ensureBrainTree, brainRoot, stateDir } = await import("./paths.js");
const { appendOpenLoops, appendOpenLoopTransition, currentOpenLoops, readOpenLoops } = await import("./wiki.js");
const { generateDigest, listDigests, readDigest } = await import("./digest.js");
const { getRedis } = await import("./redis.js");

ensureBrainTree();

after(() => {
  getRedis().disconnect();
  rmSync(brainRoot, { recursive: true, force: true });
});

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("open-loop: criação, digest com vencidos, concluir e reabrir", async () => {
  const added = await appendOpenLoops(
    [
      {
        title: "Amazon.es não reembolsou pedido 403",
        tenant: "personal",
        kind: "waiting_on",
        counterparty: "Amazon.es",
        due: yesterday,
        next_action: "Abrir hoja de reclamaciones",
        supersedes: null,
        sources: [],
      },
    ],
    ["raw/email/2026/08/x.md"],
    "gmail:t:digest-thread",
  );
  assert.equal(added, 1);

  const current = currentOpenLoops(await readOpenLoops());
  assert.equal(current.length, 1);
  assert.equal(current[0].status, "open");
  const loopId = current[0].id;

  const digest = await generateDigest();
  assert.ok(existsSync(resolve(brainRoot, digest.relPath)));
  const content = readFileSync(resolve(brainRoot, digest.relPath), "utf-8");
  assert.ok(content.includes("Vencidos"));
  assert.ok(content.includes("Amazon.es"));
  assert.ok((await listDigests()).length === 1);
  assert.ok((await readDigest((await listDigests())[0]))!.includes("Digest"));

  const closed = await appendOpenLoopTransition(loopId, "done");
  assert.ok(closed);
  assert.equal(closed.supersedes, loopId);
  const afterClose = currentOpenLoops(await readOpenLoops());
  assert.equal(afterClose.length, 1);
  assert.equal(afterClose[0].status, "done");

  assert.equal(await appendOpenLoopTransition(afterClose[0].id, "done"), null);

  const reopened = await appendOpenLoopTransition(afterClose[0].id, "open");
  assert.ok(reopened);
  const final = currentOpenLoops(await readOpenLoops());
  assert.equal(final.length, 1);
  assert.equal(final[0].status, "open");

  const entries = await readOpenLoops();
  assert.equal(entries.length, 3);
  assert.ok(existsSync(resolve(stateDir, "open-loops.md")));
});
