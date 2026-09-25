import { getSessionMessages, listSessions, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeToolAction } from "./actions.js";
import { cleanUserText, type Transcript, type TranscriptEntry, type TranscriptSessionRef } from "./transcript.js";

/** O SDK devolve estes campos em runtime além dos declarados em SessionMessage. */
interface StoredSessionMessage extends SessionMessage {
  timestamp?: unknown;
  is_meta?: unknown;
  isCompactSummary?: unknown;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
}

function contentBlocks(message: unknown): ContentBlock[] | string {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? (content.filter((b) => b && typeof b === "object") as ContentBlock[]) : [];
}

function timestampOf(message: StoredSessionMessage): string | null {
  return typeof message.timestamp === "string" && !Number.isNaN(Date.parse(message.timestamp))
    ? new Date(message.timestamp).toISOString()
    : null;
}

export function claudeEntries(messages: SessionMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const raw of messages as StoredSessionMessage[]) {
    if (raw.parent_tool_use_id || raw.is_meta === true || raw.isCompactSummary === true) continue;
    const at = timestampOf(raw);
    const blocks = contentBlocks(raw.message);
    if (raw.type === "user") {
      const text = typeof blocks === "string"
        ? blocks
        : blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n");
      const cleaned = cleanUserText(text);
      if (cleaned) entries.push({ kind: "user", at, text: cleaned });
      continue;
    }
    if (raw.type !== "assistant" || typeof blocks === "string") continue;
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        entries.push({ kind: "assistant", at, text: block.text.trim() });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const input = block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {};
        const action = claudeToolAction(block.name, input);
        if (action) entries.push({ kind: "action", at, action });
      }
    }
  }
  return entries;
}

export async function readClaudeTranscript(sessionId: string): Promise<Transcript | null> {
  const messages = await getSessionMessages(sessionId);
  if (messages.length === 0) return null;
  return { runtime: "claude", sessionId, cwd: null, entries: claudeEntries(messages) };
}

export async function listClaudeSessions(modifiedSinceMs: number): Promise<TranscriptSessionRef[]> {
  const sessions = await listSessions();
  return sessions
    .filter((s) => s.cwd && s.lastModified >= modifiedSinceMs)
    .map((s) => ({ runtime: "claude" as const, sessionId: s.sessionId, cwd: s.cwd as string, modifiedMs: s.lastModified }));
}
