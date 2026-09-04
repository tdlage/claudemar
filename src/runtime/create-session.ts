import { settingsManager } from "../settings-manager.js";
import { ClaudeSession } from "../claude/session.js";
import { CodexSession } from "../codex/session.js";
import type { AgentSession, AgentSessionInit } from "./types.js";

export function createAgentSession(init: AgentSessionInit): AgentSession {
  const profile = settingsManager.getActiveProfile();
  if (profile.runtime === "codex") return new CodexSession(init, profile);
  return new ClaudeSession(init);
}
