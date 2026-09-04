import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));

const {
  MCP_TOKEN_ENV,
  bridgedMcpConfig,
  buildCodexConfig,
  buildCodexEnv,
  buildThreadOptions,
  sandboxForPermission,
  splitMcpServers,
} = await import("../src/codex/options.js");
const { defaultLlmProfiles } = await import("../src/providers/llm.js");

function codexProfile() {
  const profile = defaultLlmProfiles().find((p) => p.id === "codex");
  assert.ok(profile);
  return profile;
}

test("buildCodexEnv remove chaves de API e credenciais da Anthropic e injeta extraEnv e token MCP", () => {
  const env = buildCodexEnv(
    { PATH: "/usr/bin", OPENAI_API_KEY: "whisper", CODEX_API_KEY: "x", ANTHROPIC_API_KEY: "y", ANTHROPIC_BASE_URL: "z", CLAUDECODE: "1", HOME: "/home/x" },
    { ...codexProfile(), extraEnv: "CODEX_HOME=/tmp/codex" },
    "tok",
  );
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/x");
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("CODEX_API_KEY" in env, false);
  assert.equal("ANTHROPIC_API_KEY" in env, false);
  assert.equal("ANTHROPIC_BASE_URL" in env, false);
  assert.equal("CLAUDECODE" in env, false);
  assert.equal(env.CODEX_HOME, "/tmp/codex");
  assert.equal(env[MCP_TOKEN_ENV], "tok");
});

test("sandboxForPermission mapeia os modos de permissão para o sandbox do Codex", () => {
  assert.deepEqual(sandboxForPermission("plan"), { sandboxMode: "read-only", networkAccessEnabled: false });
  assert.deepEqual(sandboxForPermission("default"), { sandboxMode: "workspace-write", networkAccessEnabled: true });
  assert.deepEqual(sandboxForPermission("acceptEdits"), { sandboxMode: "workspace-write", networkAccessEnabled: true });
  assert.deepEqual(sandboxForPermission("bypassPermissions"), { sandboxMode: "danger-full-access", networkAccessEnabled: true });
});

test("buildThreadOptions nunca pede aprovação e mapeia o effort", () => {
  const options = buildThreadOptions({ model: "gpt-5.6-sol", permissionMode: "bypassPermissions", effort: "max", cwd: "/tmp/p" });
  assert.equal(options.approvalPolicy, "never");
  assert.equal(options.skipGitRepoCheck, true);
  assert.equal(options.workingDirectory, "/tmp/p");
  assert.equal(options.sandboxMode, "danger-full-access");
  assert.equal(options.modelReasoningEffort, "xhigh");
  assert.equal(buildThreadOptions({ model: "m", permissionMode: "default", effort: "low", cwd: "/" }).modelReasoningEffort, "low");
});

test("splitMcpServers separa sdk, stdio, http e descarta sse", () => {
  const instance = { name: "fake" } as unknown as McpServerConfig & { type: "sdk" };
  const servers: Record<string, McpServerConfig> = {
    memory: { type: "sdk", name: "memory", instance: instance as never },
    local: { type: "stdio", command: "npx", args: ["-y", "srv"], env: { A: "1" } },
    remote: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer t" } },
    legacy: { type: "sse", url: "https://sse.example.com" },
  };
  const split = splitMcpServers(servers);
  assert.deepEqual(Object.keys(split.instances), ["memory"]);
  assert.deepEqual(split.external.local, { command: "npx", default_tools_approval_mode: "approve", args: ["-y", "srv"], env: { A: "1" } });
  assert.deepEqual(split.external.remote, { url: "https://mcp.example.com/mcp", default_tools_approval_mode: "approve", http_headers: { Authorization: "Bearer t" } });
  assert.deepEqual(split.skipped, ["legacy"]);
});

test("bridgedMcpConfig aponta cada servidor para o host local com bearer token por env", () => {
  const cfg = bridgedMcpConfig({ memory: "http://127.0.0.1:4321/memory" });
  assert.deepEqual(cfg, { memory: { url: "http://127.0.0.1:4321/memory", bearer_token_env_var: MCP_TOKEN_ENV, default_tools_approval_mode: "approve" } });
});

test("buildCodexConfig força login ChatGPT quando não há provedor customizado", () => {
  const config = buildCodexConfig({ profile: codexProfile(), developerInstructions: "instr", mcpServers: {} });
  assert.equal(config.forced_login_method, "chatgpt");
  assert.equal(config.developer_instructions, "instr");
  assert.equal(config.approval_policy, "never");
  assert.equal("model_provider" in config, false);
  assert.equal("mcp_servers" in config, false);
  assert.equal("model_context_window" in config, false);
});

test("buildCodexConfig configura provedor OpenAI-compatible customizado, janela e MCPs", () => {
  const profile = { ...codexProfile(), label: "Custom", baseUrl: "https://api.custom.ai/v1", tokenEnv: "CUSTOM_KEY", autoCompactWindow: "128000" };
  const config = buildCodexConfig({ profile, developerInstructions: "", mcpServers: { memory: { url: "http://127.0.0.1:1/memory" } } });
  assert.equal("forced_login_method" in config, false);
  assert.equal(config.model_provider, "custom");
  assert.deepEqual(config.model_providers, { custom: { name: "Custom", base_url: "https://api.custom.ai/v1", wire_api: "responses", env_key: "CUSTOM_KEY" } });
  assert.equal(config.model_context_window, 128000);
  assert.deepEqual(config.mcp_servers, { memory: { url: "http://127.0.0.1:1/memory" } });
});
