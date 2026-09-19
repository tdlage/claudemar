import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(import.meta.dirname, "../../.output/queue-persistence");
mkdirSync(output, { recursive: true });
const root = mkdtempSync(resolve(output, "test-"));
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = root;
process.env.BRAIN_ROOT = resolve(root, "brain");

const { commandQueue } = await import("../src/queue.js");
const { getPool, closePool } = await import("../src/database.js");
const { runDataMigrations } = await import("../src/data-migration.js");
after(async () => {
  await closePool();
  rmSync(root, { recursive: true, force: true });
});

function insertedRow(sql: string, values: unknown[]): Record<string, unknown> {
  const columns = /INSERT INTO queue_items \(([^)]+)\)/.exec(sql)?.[1].split(", ");
  assert.ok(columns);
  assert.equal(columns.length, values.length);
  assert.equal((sql.match(/\?/g) ?? []).length, values.length);
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
}

test("fila restaura registros legados e persiste novas tarefas sem exigir a coluna Docker", async (t) => {
  const rows: Record<string, unknown>[] = [{
    seq_id: 7, id: "legacy", target_type: "project", target_name: "app", prompt: "Preservar tarefa antiga",
    source: "web", cwd: root, resume_session_id: "old-session", model: "codex::gpt-6-astra",
    plan_mode: 1, permission_mode: "plan", agent_name: null, username: "admin", use_docker: 1,
    skip_system_prompt: 0, skip_isolation_instruction: 0, effort: "high",
    enqueued_at: new Date("2026-01-01T12:00:00Z"), telegram_chat_id: null,
  }];
  t.mock.method(getPool(), "execute", async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("SELECT * FROM queue_items")) return [rows, []];
    if (sql.startsWith("INSERT INTO queue_items")) {
      const row = insertedRow(sql, values);
      assert.equal("use_docker" in row, false);
      rows.push({ ...row, seq_id: 8 });
      return [{ insertId: 8 }, []];
    }
    assert.match(sql, /^DELETE FROM queue_items WHERE id = \?$/);
    const index = rows.findIndex((row) => row.id === values[0]);
    assert.ok(index >= 0);
    rows.splice(index, 1);
    return [{ affectedRows: 1 }, []];
  });

  await commandQueue.initialize();
  const legacy = commandQueue.getByTarget("project", "app")[0];
  assert.equal(legacy.prompt, "Preservar tarefa antiga");
  assert.equal(legacy.resumeSessionId, "old-session");
  assert.equal(legacy.permissionMode, "plan");
  assert.equal("useDocker" in legacy, false);

  const queued = await commandQueue.enqueue({
    targetType: "project", targetName: "app", prompt: "Nova tarefa", source: "web", cwd: root,
    resumeSessionId: "current-session", model: "anthropic::claude-opus-5", username: "admin",
    permissionMode: "acceptEdits", effort: "high", skipSystemPrompt: true, skipIsolationInstruction: true,
  });
  assert.equal(rows[1].resume_session_id, "current-session");
  assert.equal(rows[1].permission_mode, "acceptEdits");
  assert.equal(rows[1].skip_system_prompt, 1);
  assert.equal(rows[1].skip_isolation_instruction, 1);
  assert.equal(rows[1].effort, "high");
  assert.equal((await commandQueue.dequeue("project:app"))?.id, "legacy");
  assert.deepEqual(await commandQueue.dequeue("project:app"), queued);
  assert.deepEqual(commandQueue.getAll(), []);
  assert.deepEqual(rows, []);
});

test("migração preserva tarefas JSON antigas e sua sequência ao ignorar a opção Docker", async (t) => {
  const legacy = { nextSeqId: 90, items: [{
    id: "json-legacy", seqId: 41, targetType: "agent", targetName: "worker", prompt: "Executar depois",
    source: "web", cwd: root, resumeSessionId: "resume-me", model: "codex::gpt-6-astra",
    planMode: true, username: "admin", useDocker: true, enqueuedAt: "2026-01-01T12:00:00Z",
  }] };
  const file = resolve(root, "data/queue.json");
  writeFileSync(file, JSON.stringify(legacy));
  const statements: string[] = [];
  let migrated: Record<string, unknown> | undefined;
  t.mock.method(getPool(), "query", async () => [[], []]);
  t.mock.method(getPool(), "execute", async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql.startsWith("INSERT INTO queue_items")) migrated = insertedRow(sql, values);
    if (sql.startsWith("SELECT COUNT")) return [[{ cnt: sql.includes("INFORMATION_SCHEMA") ? 1 : 0 }], []];
    return [{ affectedRows: 1 }, []];
  });
  await runDataMigrations();
  assert.equal(migrated?.prompt, legacy.items[0].prompt);
  assert.equal(migrated?.seq_id, 41);
  assert.equal(migrated?.resume_session_id, "resume-me");
  assert.equal(migrated?.plan_mode, 1);
  assert.ok(statements.includes("ALTER TABLE queue_items AUTO_INCREMENT = 90"));
  assert.ok(statements.every((sql) => !sql.includes("use_docker") && !(sql.includes("queue_items") && /\bDROP\b/i.test(sql))));
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, "utf8")), legacy);
});
