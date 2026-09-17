import { CommitPushSession } from "./commit-push-session.js";
import { ClaudeSession } from "../claude/session.js";
import { CodexSession } from "../codex/session.js";
import type { AgentSession, AgentSessionInit } from "./types.js";

export function createAgentSession(init: AgentSessionInit): AgentSession {
  if (init.taskMode === "commit-push") return new CommitPushSession(init);
  const profile = init.profile;
  if (profile.runtime === "codex") return new CodexSession(init, profile);
  return new ClaudeSession(init);
}
