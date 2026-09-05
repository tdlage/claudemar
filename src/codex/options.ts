import type { McpServerConfig, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelReasoningEffort, SandboxMode, ThreadOptions } from "@openai/codex-sdk";
import { parseExtraEnv, type LlmProfile } from "../providers/llm.js";
import type { Effort } from "../runtime/types.js";

export type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject;
export type CodexConfigObject = { [key: string]: CodexConfigValue };

export const MCP_TOKEN_ENV = "CLAUDEMAR_MCP_TOKEN";

// Os modelos GPT rodam sempre pela assinatura do ChatGPT (login do Codex). Qualquer chave de
// API herdada do processo (OPENAI_API_KEY é do Whisper) e as credenciais da Anthropic ficam
// fora do ambiente do CLI.
const STRIPPED_ENV_KEYS = ["OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDECODE"];

export function stripCodexCredentials(baseEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of STRIPPED_ENV_KEYS) delete env[key];
  return env;
}

export function buildCodexEnv(baseEnv: NodeJS.ProcessEnv, profile: LlmProfile, mcpToken?: string): Record<string, string> {
  const env = stripCodexCredentials(baseEnv);
  for (const [key, value] of parseExtraEnv(profile.extraEnv)) env[key] = value;
  if (mcpToken) env[MCP_TOKEN_ENV] = mcpToken;
  return env;
}

export interface SandboxSettings {
  sandboxMode: SandboxMode;
  networkAccessEnabled: boolean;
}

// O `codex exec` não pede aprovação interativa: os modos de permissão viram níveis de sandbox.
export function sandboxForPermission(mode: PermissionMode): SandboxSettings {
  if (mode === "plan") return { sandboxMode: "read-only", networkAccessEnabled: false };
  if (mode === "bypassPermissions") return { sandboxMode: "danger-full-access", networkAccessEnabled: true };
  return { sandboxMode: "workspace-write", networkAccessEnabled: true };
}

export const EFFORT_CODEX: Record<Effort, ModelReasoningEffort> = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  extra: "xhigh",
  max: "xhigh",
  ultracode: "xhigh",
};

export interface CodexTurnState {
  model: string;
  permissionMode: PermissionMode;
  effort: Effort;
  cwd: string;
}

export function buildThreadOptions(state: CodexTurnState): ThreadOptions {
  const sandbox = sandboxForPermission(state.permissionMode);
  return {
    model: state.model,
    sandboxMode: sandbox.sandboxMode,
    networkAccessEnabled: sandbox.networkAccessEnabled,
    workingDirectory: state.cwd,
    skipGitRepoCheck: true,
    modelReasoningEffort: EFFORT_CODEX[state.effort],
    approvalPolicy: "never",
  };
}

// Com approval_policy "never" o Codex recusa chamadas MCP que exigiriam aprovação; cada
// servidor precisa liberar suas tools explicitamente.
const MCP_AUTO_APPROVE: CodexConfigObject = { default_tools_approval_mode: "approve" };

export interface SplitMcpServers {
  instances: Record<string, McpServer>;
  external: Record<string, CodexConfigObject>;
  skipped: string[];
}

// Servidores in-process do Agent SDK (type "sdk") são expostos ao Codex por HTTP local pelo
// mcp-host; stdio e HTTP vão direto para a config do Codex. SSE não é suportado pelo Codex.
export function splitMcpServers(servers: Record<string, McpServerConfig>): SplitMcpServers {
  const result: SplitMcpServers = { instances: {}, external: {}, skipped: [] };
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.type === "sdk") {
      result.instances[name] = cfg.instance as McpServer;
    } else if (cfg.type === "http") {
      const entry: CodexConfigObject = { url: cfg.url, ...MCP_AUTO_APPROVE };
      if (cfg.headers && Object.keys(cfg.headers).length > 0) entry.http_headers = { ...cfg.headers };
      result.external[name] = entry;
    } else if (cfg.type === "sse") {
      result.skipped.push(name);
    } else {
      const entry: CodexConfigObject = { command: cfg.command, ...MCP_AUTO_APPROVE };
      if (cfg.args && cfg.args.length > 0) entry.args = [...cfg.args];
      if (cfg.env && Object.keys(cfg.env).length > 0) entry.env = { ...cfg.env };
      result.external[name] = entry;
    }
  }
  return result;
}

export function bridgedMcpConfig(urls: Record<string, string>): Record<string, CodexConfigObject> {
  const config: Record<string, CodexConfigObject> = {};
  for (const [name, url] of Object.entries(urls)) {
    config[name] = { url, bearer_token_env_var: MCP_TOKEN_ENV, ...MCP_AUTO_APPROVE };
  }
  return config;
}

export interface CodexConfigParams {
  profile: LlmProfile;
  developerInstructions: string;
  mcpServers: Record<string, CodexConfigObject>;
}

export function buildCodexConfig(params: CodexConfigParams): CodexConfigObject {
  const { profile } = params;
  const config: CodexConfigObject = {
    developer_instructions: params.developerInstructions,
    approval_policy: "never",
  };

  const baseUrl = profile.baseUrl.trim();
  if (baseUrl) {
    const provider: CodexConfigObject = { name: profile.label, base_url: baseUrl, wire_api: "responses" };
    if (profile.tokenEnv.trim()) provider.env_key = profile.tokenEnv.trim();
    config.model_provider = "custom";
    config.model_providers = { custom: provider };
  } else {
    config.forced_login_method = "chatgpt";
  }

  const window = Number(profile.autoCompactWindow.trim());
  if (Number.isFinite(window) && window > 0) config.model_context_window = window;

  if (Object.keys(params.mcpServers).length > 0) config.mcp_servers = params.mcpServers;

  return config;
}
