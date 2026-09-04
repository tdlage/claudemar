import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const { toolUsesForItem, usageTokens } = await import("../src/codex/session.js");

test("command_execution vira Bash só no início", () => {
  const item = { id: "1", type: "command_execution" as const, command: "ls -la", aggregated_output: "", status: "in_progress" as const };
  assert.deepEqual(toolUsesForItem(item, "started"), [{ name: "Bash", input: { command: "ls -la" } }]);
  assert.deepEqual(toolUsesForItem(item, "completed"), []);
});

test("file_change vira Write/Edit por arquivo e rm para remoções", () => {
  const item = {
    id: "2",
    type: "file_change" as const,
    status: "completed" as const,
    changes: [
      { path: "a.ts", kind: "add" as const },
      { path: "b.ts", kind: "update" as const },
      { path: "c.ts", kind: "delete" as const },
    ],
  };
  assert.deepEqual(toolUsesForItem(item, "completed"), [
    { name: "Write", input: { file_path: "a.ts" } },
    { name: "Edit", input: { file_path: "b.ts" } },
    { name: "Bash", input: { command: "rm c.ts" } },
  ]);
  assert.deepEqual(toolUsesForItem(item, "started"), []);
});

test("mcp_tool_call usa o nome qualificado mcp__server__tool", () => {
  const item = { id: "3", type: "mcp_tool_call" as const, server: "memory", tool: "search_memory", arguments: { query: "x" }, status: "in_progress" as const };
  assert.deepEqual(toolUsesForItem(item, "started"), [{ name: "mcp__memory__search_memory", input: { query: "x" } }]);
});

test("web_search e todo_list mapeiam para WebSearch e TodoWrite", () => {
  assert.deepEqual(toolUsesForItem({ id: "4", type: "web_search", query: "codex" }, "completed"), [{ name: "WebSearch", input: { query: "codex" } }]);
  const todos = [{ text: "a", completed: false }];
  assert.deepEqual(toolUsesForItem({ id: "5", type: "todo_list", items: todos }, "started"), [{ name: "TodoWrite", input: { todos } }]);
});

test("agent_message, reasoning e error não geram toolUse", () => {
  assert.deepEqual(toolUsesForItem({ id: "6", type: "agent_message", text: "oi" }, "completed"), []);
  assert.deepEqual(toolUsesForItem({ id: "7", type: "reasoning", text: "pensando" }, "completed"), []);
  assert.deepEqual(toolUsesForItem({ id: "8", type: "error", message: "x" }, "completed"), []);
});

test("usageTokens soma entrada+saída e contexto = entrada+cache", () => {
  const usage = { input_tokens: 100, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 10 };
  assert.deepEqual(usageTokens(usage), { total: 150, context: 500 });
});
