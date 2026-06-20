import type { AgentDefinition, CanUseTool, McpServerConfig, Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { createMemoryMcpServer, memoryEnabled, type MemoryTarget } from "../memory/session-memory.js";
import { createSchedulerMcpServer } from "../agents/scheduler.js";

export type Effort = "low" | "medium" | "high" | "extra" | "max" | "ultracode";
export type SdkEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type SdkFlagEffortLevel = "low" | "medium" | "high" | "xhigh";

const EFFORT_SDK: Record<Effort, SdkEffortLevel> = {
  low: "low",
  medium: "medium",
  high: "high",
  extra: "xhigh",
  max: "max",
  ultracode: "xhigh",
};

export const EFFORTS = Object.keys(EFFORT_SDK) as Effort[];

export function effortToSdk(effort: Effort): SdkEffortLevel {
  return EFFORT_SDK[effort];
}

// The live flag layer (applyFlagSettings) only accepts up to "xhigh"; "max" is
// reachable solely at session start through Options.effort.
export function effortToFlagLevel(effort: Effort): SdkFlagEffortLevel {
  const level = EFFORT_SDK[effort];
  return level === "max" ? "xhigh" : level;
}

export function isUltracode(effort: Effort | undefined): boolean {
  return effort === "ultracode";
}

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
  effort?: Effort;
  systemAppend?: string;
  subagents?: Record<string, AgentDefinition>;
  schedulerMode?: boolean;
  extraMcpServers?: Record<string, McpServerConfig>;
  squadSkills?: string[];
  stderr?: (data: string) => void;
}

function buildSystemAppend(params: BuildOptionsParams): string {
  const parts: string[] = [];
  parts.push(
    `Você está confinado ao diretório ${params.cwd}. NÃO leia, liste ou acesse arquivos fora deste diretório ou de seus subdiretórios, e nunca navegue para diretórios pai.`,
  );
  if (memoryEnabled()) {
    parts.push(
      "Você tem memória de longo prazo de sessões ANTERIORES (fora desta conversa), guardada por projeto/agente. Esta sessão NÃO injeta esse histórico automaticamente: quando o pedido depender de algo discutido ou decidido antes que não esteja nesta conversa, use a tool mcp__memory__search_memory para buscar nas sessões anteriores deste mesmo alvo, e mcp__memory__memory_history para ver como um fato específico (sourceKey) evoluiu ao longo do tempo. Não invente histórico: se precisar, consulte a memória.",
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
  const effort = params.effort ?? "high";

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
    effort: effortToSdk(effort),
    stderr: params.stderr,
  };

  if (permissionMode === "bypassPermissions") {
    options.allowDangerouslySkipPermissions = true;
  }

  if (params.agentName) {
    options.extraArgs = { agent: params.agentName };
  }

  if (params.resumeSessionId) {
    options.resume = params.resumeSessionId;
    if (params.forkSession) options.forkSession = true;
  }

  const mcpServers: NonNullable<Options["mcpServers"]> = {};
  if (params.extraMcpServers) {
    for (const [name, cfg] of Object.entries(params.extraMcpServers)) mcpServers[name] = cfg;
  }
  const memoryServer = createMemoryMcpServer(params.target);
  if (memoryServer) {
    mcpServers.memory = memoryServer;
  }
  if (params.schedulerMode && params.target.targetType === "agent") {
    mcpServers.scheduler = createSchedulerMcpServer(params.target.targetName);
  }
  if (Object.keys(mcpServers).length > 0) {
    options.mcpServers = mcpServers;
  }

  if (params.squadSkills && params.squadSkills.length > 0) {
    options.skills = params.squadSkills;
  }

  if (params.subagents && Object.keys(params.subagents).length > 0) {
    options.agents = params.subagents;
    options.allowedTools = ["Agent"];
  }

  return options;
}
