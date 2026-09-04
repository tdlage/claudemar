import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";
import { settingsManager } from "../settings-manager.js";
import { applyProfile } from "../providers/llm.js";
import { DEFAULT_PROJECT_MODEL, normalizeModel } from "../models-discovery.js";
import { buildSystemAppend } from "../runtime/system-append.js";
import { collectSessionMcpServers } from "../runtime/mcp-servers.js";
import { resolveInitialPermissionMode } from "../runtime/permission-mode.js";
import type { AgentSessionInit, Effort } from "../runtime/types.js";

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

export interface BuildOptionsParams extends AgentSessionInit {
  abortController: AbortController;
  canUseTool: CanUseTool;
}

export function buildOptions(params: BuildOptionsParams): Options {
  const env = applyProfile(process.env, settingsManager.getActiveProfile());
  delete env.CLAUDECODE;

  const permissionMode = resolveInitialPermissionMode(params);
  const effort = params.effort ?? "high";

  const options: Options = {
    model: normalizeModel(params.model ?? DEFAULT_PROJECT_MODEL),
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

  const mcpServers = collectSessionMcpServers(params);
  if (Object.keys(mcpServers).length > 0) {
    options.mcpServers = mcpServers;
  }

  if (params.skills && params.skills.length > 0) {
    options.skills = params.skills;
  }

  if (params.subagents && Object.keys(params.subagents).length > 0) {
    options.agents = params.subagents;
    options.allowedTools = ["Agent"];
  }

  return options;
}
