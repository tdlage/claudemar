import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionInit } from "./types.js";

export function resolveInitialPermissionMode(init: Pick<AgentSessionInit, "planMode" | "permissionMode" | "bypassPermissions">): PermissionMode {
  if (init.planMode) return "plan";
  if (init.permissionMode) return init.permissionMode;
  return init.bypassPermissions ? "bypassPermissions" : "default";
}
