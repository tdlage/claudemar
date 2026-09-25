import { open, readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";
import { getCodexHome } from "../../codex/auth.js";
import { codexThreadIdFromFileName } from "../../session-validator.js";
import { codexCustomToolActions, codexFunctionActions, codexShellActions, type ToolAction } from "./actions.js";
import { cleanUserText, type Transcript, type TranscriptEntry, type TranscriptSessionRef } from "./transcript.js";

const decompress = promisify(zstdDecompress);

const SESSION_DIRS = ["sessions", "archived_sessions"];
const ROLLOUT_FILE_RE = /\.jsonl(\.zst)?$/;
const INDEX_TTL_MS = 60_000;
const META_PROBE_BYTES = 1024 * 1024;

interface RolloutFile {
  path: string;
  threadId: string;
  mtimeMs: number;
}

let index: { byId: Map<string, RolloutFile>; at: number } | null = null;

async function collect(dir: string, depth: number, out: RolloutFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) await collect(path, depth - 1, out);
      continue;
    }
    if (!ROLLOUT_FILE_RE.test(entry.name)) continue;
    const threadId = codexThreadIdFromFileName(entry.name);
    if (!threadId) continue;
    const info = await stat(path).catch(() => null);
    if (info) out.push({ path, threadId, mtimeMs: info.mtimeMs });
  }
}

async function listRolloutFiles(): Promise<RolloutFile[]> {
  const files: RolloutFile[] = [];
  for (const sub of SESSION_DIRS) await collect(resolve(getCodexHome(), sub), 3, files);
  return files;
}

async function rolloutIndex(force: boolean): Promise<Map<string, RolloutFile>> {
  if (!force && index && Date.now() - index.at < INDEX_TTL_MS) return index.byId;
  const byId = new Map<string, RolloutFile>();
  for (const file of await listRolloutFiles()) {
    const current = byId.get(file.threadId);
    if (!current || file.mtimeMs > current.mtimeMs) byId.set(file.threadId, file);
  }
  index = { byId, at: Date.now() };
  return byId;
}

async function findRollout(threadId: string): Promise<RolloutFile | null> {
  const id = threadId.toLowerCase();
  return (await rolloutIndex(false)).get(id) ?? (await rolloutIndex(true)).get(id) ?? null;
}

async function readRolloutLines(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path);
  const text = (path.endsWith(".zst") ? await decompress(raw) : raw).toString("utf-8");
  const lines: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const parsed = line.trim() ? parseLine(line) : null;
    if (parsed) lines.push(parsed);
  }
  return lines;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readFirstLine(path: string): Promise<Record<string, unknown> | null> {
  if (path.endsWith(".zst")) return (await readRolloutLines(path))[0] ?? null;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(META_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, META_PROBE_BYTES, 0);
    const chunk = buffer.subarray(0, bytesRead).toString("utf-8");
    const end = chunk.indexOf("\n");
    if (end >= 0) return parseLine(chunk.slice(0, end));
  } finally {
    await handle.close();
  }
  return (await readRolloutLines(path))[0] ?? null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function messageText(content: unknown): string {
  if (!Array.isArray(content)) return text(content);
  return content
    .map(record)
    .filter((c) => c.type === "input_text" || c.type === "output_text" || c.type === "text")
    .map((c) => text(c.text))
    .join("\n")
    .trim();
}

function timestampOf(line: Record<string, unknown>): string | null {
  const value = text(line.timestamp);
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

interface Sequenced {
  seq: number;
  entry: TranscriptEntry;
}

function responseActions(payload: Record<string, unknown>): ToolAction[] {
  switch (payload.type) {
    case "function_call":
      return codexFunctionActions(text(payload.name), text(payload.namespace), payload.arguments);
    case "custom_tool_call":
      return codexCustomToolActions(text(payload.name), text(payload.input));
    case "local_shell_call":
      return codexShellActions(record(payload.action).command);
    case "web_search_call": {
      const query = text(record(payload.action).query);
      return query ? [{ kind: "web", detail: query }] : [];
    }
    default:
      return [];
  }
}

/**
 * Rollouts antigos (modo legado) trazem user_message/agent_message limpos em event_msg; os
 * paginados só têm response_item, onde o contexto injetado (AGENTS.md, environment_context)
 * aparece como mensagem de usuário e precisa ser filtrado.
 */
export function codexEntries(lines: Record<string, unknown>[]): { cwd: string | null; entries: TranscriptEntry[] } {
  let cwd: string | null = null;
  const eventUsers: Sequenced[] = [];
  const eventAgents: Sequenced[] = [];
  const itemUsers: Sequenced[] = [];
  const itemAgents: Sequenced[] = [];
  const actions: Sequenced[] = [];

  lines.forEach((line, seq) => {
    const at = timestampOf(line);
    const payload = record(line.payload);
    if (line.type === "session_meta") {
      cwd = text(payload.cwd) || cwd;
      return;
    }
    if (line.type === "event_msg") {
      const message = text(payload.message).trim();
      if (payload.type === "user_message" && message) eventUsers.push({ seq, entry: { kind: "user", at, text: message } });
      if (payload.type === "agent_message" && message) eventAgents.push({ seq, entry: { kind: "assistant", at, text: message } });
      return;
    }
    if (line.type !== "response_item") return;
    if (payload.type === "message") {
      const body = messageText(payload.content);
      if (payload.role === "user") {
        const cleaned = cleanUserText(body);
        if (cleaned) itemUsers.push({ seq, entry: { kind: "user", at, text: cleaned } });
      } else if (payload.role === "assistant" && body) {
        itemAgents.push({ seq, entry: { kind: "assistant", at, text: body } });
      }
      return;
    }
    for (const action of responseActions(payload)) actions.push({ seq, entry: { kind: "action", at, action } });
  });

  const merged = [
    ...(eventUsers.length > 0 ? eventUsers : itemUsers),
    ...(eventAgents.length > 0 ? eventAgents : itemAgents),
    ...actions,
  ].sort((a, b) => a.seq - b.seq);
  return { cwd, entries: merged.map((s) => s.entry) };
}

export async function readCodexTranscript(threadId: string): Promise<Transcript | null> {
  const file = await findRollout(threadId);
  if (!file) return null;
  const { cwd, entries } = codexEntries(await readRolloutLines(file.path));
  return { runtime: "codex", sessionId: threadId.toLowerCase(), cwd, entries };
}

export async function listCodexSessions(modifiedSinceMs: number): Promise<TranscriptSessionRef[]> {
  const refs: TranscriptSessionRef[] = [];
  for (const file of (await rolloutIndex(true)).values()) {
    if (file.mtimeMs < modifiedSinceMs) continue;
    const first = await readFirstLine(file.path).catch(() => null);
    const cwd = first?.type === "session_meta" ? text(record(first.payload).cwd) : "";
    if (cwd) refs.push({ runtime: "codex", sessionId: file.threadId, cwd, modifiedMs: file.mtimeMs });
  }
  return refs;
}
