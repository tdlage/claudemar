import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { createMemoryMcpServer } from "../memory/session-memory.js";
import { createBrainMcpServer } from "../brain/mcp.js";
import { createSchedulerMcpServer } from "../agents/scheduler.js";
import { createGoogleFilesMcpServer, hasGoogleFileTools } from "../google-drive/native-tools.js";
import type { AgentSessionInit } from "./types.js";

// Servidores MCP in-process de uma sessão, iguais para qualquer runtime.
export function collectSessionMcpServers(init: AgentSessionInit): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = { ...(init.extraMcpServers ?? {}) };
  const memoryServer = createMemoryMcpServer(init.target);
  if (memoryServer) servers.memory = memoryServer;
  if (init.target.targetType === "orchestrator") servers.brain = createBrainMcpServer();
  if (init.schedulerMode && init.target.targetType === "agent") servers.scheduler = createSchedulerMcpServer(init.target.targetName);
  if (init.target.targetType === "agent" && hasGoogleFileTools(init.target.targetName)) servers.gdrive = createGoogleFilesMcpServer(init.target.targetName);
  return servers;
}
