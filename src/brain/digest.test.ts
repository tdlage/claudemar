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

const { ensureBrainTree } = await import("./paths.js");
const { adminBrain } = await import("./scope.js");
const scope = adminBrain();
const brainRoot = scope.root;
const stateDir = scope.stateDir;
const { appendOpenLoops, appendOpenLoopTransition, appendOpenLoopTransitions, currentOpenLoops, readOpenLoops } = await import("./wiki.js");
const { generateDigest, listDigests, readDigest } = await import("./digest.js");
const { getRedis } = await import("./redis.js");

ensureBrainTree(scope);

after(() => {
  getRedis().disconnect();
  rmSync(brainRoot, { recursive: true, force: true });
});

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("open-loop: criação, digest com vencidos, concluir e reabrir", async () => {
  const added = await appendOpenLoops(scope, 
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

  const current = currentOpenLoops(await readOpenLoops(scope));
  assert.equal(current.length, 1);
  assert.equal(current[0].status, "open");
  const loopId = current[0].id;

  const digest = await generateDigest(scope);
  assert.ok(existsSync(resolve(brainRoot, digest.relPath)));
  const content = readFileSync(resolve(brainRoot, digest.relPath), "utf-8");
  assert.ok(content.includes("Vencidos"));
  assert.ok(content.includes("Amazon.es"));
  assert.ok((await listDigests(scope)).length === 1);
  assert.ok((await readDigest(scope, (await listDigests(scope))[0]))!.includes("Digest"));

  const closed = await appendOpenLoopTransition(scope, loopId, "done");
  assert.ok(closed);
  assert.equal(closed.supersedes, loopId);
  const afterClose = currentOpenLoops(await readOpenLoops(scope));
  assert.equal(afterClose.length, 1);
  assert.equal(afterClose[0].status, "done");

  assert.equal(await appendOpenLoopTransition(scope, afterClose[0].id, "done"), null);

  const reopened = await appendOpenLoopTransition(scope, afterClose[0].id, "open");
  assert.ok(reopened);
  const final = currentOpenLoops(await readOpenLoops(scope));
  assert.equal(final.length, 1);
  assert.equal(final[0].status, "open");

  const entries = await readOpenLoops(scope);
  assert.equal(entries.length, 3);
  assert.ok(existsSync(resolve(stateDir, "open-loops.md")));
});

test("open-loop: ignorar e transições em lote numa escrita só", async () => {
  const loop = (title: string) => ({ title, tenant: "personal" as const, kind: "my_commitment" as const, counterparty: "Equipe", due: null, next_action: "", supersedes: null, sources: [] });
  await appendOpenLoops(scope, [loop("Enviar proposta"), loop("Revisar contrato"), loop("Ligar para fornecedor")], [], "gmail:t:bulk-thread");
  const open = currentOpenLoops(await readOpenLoops(scope)).filter((l) => l.status === "open" && l.counterparty === "Equipe");
  assert.equal(open.length, 3);

  const ignored = await appendOpenLoopTransitions(scope, [open[0].id, open[1].id, open[1].id, "ol-inexistente"], "abandoned");
  assert.equal(ignored.length, 2);
  assert.ok(ignored.every((t) => t.status === "abandoned"));

  const afterIgnore = currentOpenLoops(await readOpenLoops(scope)).filter((l) => l.counterparty === "Equipe");
  assert.deepEqual(afterIgnore.map((l) => l.status).sort(), ["abandoned", "abandoned", "open"]);
  assert.equal((await appendOpenLoopTransitions(scope, ignored.map((t) => t.id), "abandoned")).length, 0);

  const reopened = await appendOpenLoopTransitions(scope, [ignored[0].id], "open");
  assert.equal(reopened.length, 1);
  assert.equal(currentOpenLoops(await readOpenLoops(scope)).filter((l) => l.counterparty === "Equipe" && l.status === "open").length, 2);

  const again = await appendOpenLoops(scope, [loop("Revisar contrato")], [], "gmail:t:bulk-thread");
  assert.equal(again, 0, "o compilador não recria uma pendência ignorada da mesma thread");
});
