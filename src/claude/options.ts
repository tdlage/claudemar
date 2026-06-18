import type { CanUseTool, Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { createMemoryMcpServer, memoryEnabled, type MemoryTarget } from "../memory/session-memory.js";

export type ThinkingLevel = "off" | "think" | "think_hard" | "ultrathink";

export interface BuildOptionsParams {
  cwd: string;
  target: MemoryTarget;
  abortController: AbortController;
  canUseTool: CanUseTool;
  model?: string;
  agentName?: string;
  planMode?: boolean;
  permissionMode?: PermissionMode;
  bypassPermissions?: boolean;
  resumeSessionId?: string | null;
  forkSession?: boolean;
  thinking?: ThinkingLevel;
  systemAppend?: string;
  stderr?: (data: string) => void;
}

export const THINKING_TOKENS: Record<ThinkingLevel, number | null> = {
  off: null,
  think: 4000,
  think_hard: 10000,
  ultrathink: 31999,
};

function buildSystemAppend(params: BuildOptionsParams): string {
  const parts: string[] = [];
  parts.push(
    `Você está confinado ao diretório ${params.cwd}. NÃO leia, liste ou acesse arquivos fora deste diretório ou de seus subdiretórios, e nunca navegue para diretórios pai.`,
  );
  if (memoryEnabled()) {
    parts.push(
      "Você tem memória de longo prazo. Use a tool mcp__memory__search_memory para recuperar fatos, decisões e contexto de sessões anteriores antes de responder quando o pedido depender de histórico, e mcp__memory__memory_history para ver a evolução de um fato específico.",
    );
  }
  if (params.systemAppend) parts.push(params.systemAppend);
  return parts.join("\n\n");
}

function resolvePermissionMode(params: BuildOptionsParams): PermissionMode {
  if (params.planMode) return "plan";
  if (params.permissionMode) return params.permissionMode;
  return params.bypassPermissions ? "bypassPermissions" : "default";
}

export function buildOptions(params: BuildOptionsParams): Options {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const permissionMode = resolvePermissionMode(params);
  const thinking = params.thinking ?? "off";
  const maxThinkingTokens = THINKING_TOKENS[thinking];

  const options: Options = {
    model: params.model ?? "opus",
    cwd: params.cwd,
    env,
    abortController: params.abortController,
    canUseTool: params.canUseTool,
    permissionMode,
    settingSources: ["project"],
    includePartialMessages: true,
    enableFileCheckpointing: true,
    systemPrompt: { type: "preset", preset: "claude_code", append: buildSystemAppend(params) },
    stderr: params.stderr,
  };

  if (permissionMode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }

  if (maxThinkingTokens !== null) {
    options.maxThinkingTokens = maxThinkingTokens;
  }

  if (params.agentName) {
    options.extraArgs = { agent: params.agentName };
  }

  if (params.resumeSessionId) {
    options.resume = params.resumeSessionId;
    if (params.forkSession) options.forkSession = true;
  }

  const memoryServer = createMemoryMcpServer(params.target);
  if (memoryServer) {
    options.mcpServers = { memory: memoryServer };
  }

  return options;
}
