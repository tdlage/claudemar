import type { RowDataPacket } from "mysql2/promise";
import { query } from "../../database.js";
import { sessionNamesManager } from "../../session-names-manager.js";
import type { HistoryEntry } from "../../history.js";
import type { AgentRuntime } from "../../providers/llm.js";
import type { CanonicalEvent, CanonicalParticipant } from "../types.js";
import { splitFormattedOutput, summarizeActions, type ToolAction } from "./actions.js";
import { CLAUDEMAR_ACCOUNT, SYSTEM_HANDLE } from "./managed.js";
import { targetHandle, targetLabel, targetRoot, type ClaudemarTarget } from "./targets.js";
import type { TranscriptTurn } from "./transcript.js";

const MAX_BLOCK_CHARS = 19_000;
const CLIP_HEAD_RATIO = 0.3;
const SUBJECT_CHARS = 90;

export function clipMiddle(text: string, max = MAX_BLOCK_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * CLIP_HEAD_RATIO);
  const tail = max - head;
  return `${text.slice(0, head).trimEnd()}\n\n[… ${text.length - max} caracteres omitidos …]\n\n${text.slice(text.length - tail).trimStart()}`;
}

function firstLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || "(sem texto)";
}

function shiftIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function laterIso(a: string | null, b: string): string {
  if (!a) return b;
  return Date.parse(a) > Date.parse(b) ? a : b;
}

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function targetParticipant(target: ClaudemarTarget, role: string): CanonicalParticipant {
  return { name: targetLabel(target), handle: targetHandle(target), role };
}

const SYSTEM_PARTICIPANT: CanonicalParticipant = { name: "claudemar", handle: SYSTEM_HANDLE, role: "from" };

function requesterName(entry: Pick<HistoryEntry, "username" | "source">): string {
  if (entry.username?.startsWith("pipeline")) return "pipeline do claudemar";
  if (entry.username) return entry.username;
  if (entry.source === "schedule") return "agendamento";
  if (entry.source === "telegram") return "usuário (Telegram)";
  return "usuário";
}

function requester(entry: Pick<HistoryEntry, "username" | "source">, role: string): CanonicalParticipant {
  const id = entry.username || entry.source || "usuario";
  return { name: requesterName(entry), handle: `claudemar:user:${id}`, role };
}

const cardLabels = new Map<string, string | null>();

async function pipelineCardLabel(username: string | undefined): Promise<string | null> {
  const match = /^pipeline:(.+)$/.exec(username ?? "");
  if (!match) return null;
  const cardId = match[1];
  if (cardLabels.has(cardId)) return cardLabels.get(cardId) ?? null;
  const rows = await query<(RowDataPacket & { seq_number: number; title: string })[]>(
    "SELECT seq_number, title FROM pipeline_cards WHERE id = ?",
    [cardId],
  );
  const label = rows[0] ? `card #${rows[0].seq_number} "${rows[0].title}" do pipeline` : null;
  cardLabels.set(cardId, label);
  return label;
}

interface ExecutionContent {
  followUps: { at: string | null; text: string }[];
  response: string;
  actions: ToolAction[];
  fromTranscript: boolean;
}

function executionContent(entry: HistoryEntry, turn: TranscriptTurn | null): ExecutionContent {
  const history = splitFormattedOutput(entry.output ?? "");
  if (!turn) return { followUps: [], response: history.text, actions: history.actions, fromTranscript: false };
  const response = turn.assistant.join("\n\n").trim();
  return {
    followUps: turn.followUps,
    response: response || history.text,
    actions: turn.actions.length > 0 ? turn.actions : history.actions,
    fromTranscript: true,
  };
}

export function executionThreadKey(executionId: string): string {
  return `cm:exec:${executionId}`;
}

export async function buildExecutionEvents(
  entry: HistoryEntry,
  target: ClaudemarTarget,
  turn: TranscriptTurn | null,
): Promise<CanonicalEvent[]> {
  const threadKey = executionThreadKey(entry.id);
  const startedAt = entry.startedAt;
  const finishedAt = laterIso(
    entry.completedAt ?? (entry.durationMs ? shiftIso(startedAt, entry.durationMs) : turn?.endedAt ?? null),
    shiftIso(startedAt, 1),
  );
  const content = executionContent(entry, turn);
  const subject = `${targetLabel(target)} — ${firstLine(entry.prompt, SUBJECT_CHARS)}`;
  const runtime: AgentRuntime | undefined = entry.runtime;
  const rawRef = entry.sessionId ? `${runtime ?? "claude"}:${entry.sessionId}` : `exec:${entry.id}`;
  const base = { channel: "claudemar" as const, subchannel: "direct" as const, account: CLAUDEMAR_ACCOUNT, thread_key: threadKey, subject, attachments: [], raw_ref: rawRef };

  const events: CanonicalEvent[] = [
    {
      ...base,
      external_id: `${threadKey}:prompt`,
      occurred_at: startedAt,
      participants: [targetParticipant(target, "agent"), requester(entry, "from")],
      body_text: clipMiddle(entry.prompt),
    },
  ];

  content.followUps.forEach((message, index) => {
    const at = laterIso(message.at, shiftIso(startedAt, index + 1));
    events.push({
      ...base,
      external_id: `${threadKey}:user:${index + 1}`,
      occurred_at: at < finishedAt ? at : shiftIso(finishedAt, -(content.followUps.length - index)),
      participants: [requester(entry, "from"), targetParticipant(target, "agent")],
      body_text: clipMiddle(message.text),
    });
  });

  const errorLine = entry.error && entry.status !== "completed" ? `\n\nErro: ${entry.error}` : "";
  const response = `${content.response}${errorLine}`.trim();
  if (response) {
    events.push({
      ...base,
      external_id: `${threadKey}:response`,
      occurred_at: finishedAt,
      participants: [targetParticipant(target, "from"), requester(entry, "to")],
      body_text: clipMiddle(response),
    });
  }

  const sessionName = entry.sessionId ? sessionNamesManager.getName(entry.sessionId) : undefined;
  const card = await pipelineCardLabel(entry.username);
  const meta = [
    `Execução ${entry.id} (${targetLabel(target)}) · status ${entry.status}`,
    `runtime ${runtime ?? "desconhecido"}${entry.model ? ` · modelo ${entry.model}` : ""}`,
    `origem ${entry.source}${entry.username ? ` · solicitante ${entry.username}` : ""}`,
    `início ${startedAt} · duração ${formatDuration(entry.durationMs)}`,
    entry.costUsd > 0 ? `custo US$ ${entry.costUsd.toFixed(2)}` : "",
    entry.sessionId ? `sessão ${sessionName ? `"${sessionName}" ` : ""}(${entry.sessionId})` : "",
    card ?? "",
    entry.planMode ? "modo plano" : "",
    content.fromTranscript ? "detalhes do transcript" : "detalhes do histórico",
  ].filter(Boolean);
  const actions = summarizeActions(content.actions, targetRoot(target));
  events.push({
    ...base,
    external_id: `${threadKey}:actions`,
    occurred_at: shiftIso(finishedAt, 1),
    participants: [SYSTEM_PARTICIPANT, targetParticipant(target, "agent")],
    body_text: clipMiddle(`${meta.join(" · ")}\n\n${actions || "- Nenhuma ação de escrita, comando ou ferramenta registrada."}`),
  });
  return events;
}

export function orphanTurnThreadKey(runtime: AgentRuntime, sessionId: string, turnIndex: number): string {
  return `cm:turn:${runtime}:${sessionId}:${turnIndex}`;
}

export function buildOrphanTurnEvents(
  runtime: AgentRuntime,
  sessionId: string,
  turnIndex: number,
  target: ClaudemarTarget,
  turn: TranscriptTurn,
  fallbackAt: string,
): CanonicalEvent[] {
  const threadKey = orphanTurnThreadKey(runtime, sessionId, turnIndex);
  const startedAt = turn.startedAt ?? fallbackAt;
  const finishedAt = laterIso(turn.endedAt, shiftIso(startedAt, 1));
  const author: CanonicalParticipant = { name: "usuário", handle: "claudemar:user:transcript", role: "from" };
  const base = {
    channel: "claudemar" as const,
    subchannel: "direct" as const,
    account: CLAUDEMAR_ACCOUNT,
    thread_key: threadKey,
    subject: `${targetLabel(target)} — ${firstLine(turn.prompt.text, SUBJECT_CHARS)}`,
    attachments: [],
    raw_ref: `${runtime}:${sessionId}`,
  };
  const events: CanonicalEvent[] = [
    {
      ...base,
      external_id: `${threadKey}:prompt`,
      occurred_at: startedAt,
      participants: [targetParticipant(target, "agent"), author],
      body_text: clipMiddle(turn.prompt.text),
    },
  ];
  turn.followUps.forEach((message, index) => {
    events.push({
      ...base,
      external_id: `${threadKey}:user:${index + 1}`,
      occurred_at: laterIso(message.at, shiftIso(startedAt, index + 1)),
      participants: [author, targetParticipant(target, "agent")],
      body_text: clipMiddle(message.text),
    });
  });
  const response = turn.assistant.join("\n\n").trim();
  if (response) {
    events.push({
      ...base,
      external_id: `${threadKey}:response`,
      occurred_at: finishedAt,
      participants: [targetParticipant(target, "from"), { ...author, role: "to" }],
      body_text: clipMiddle(response),
    });
  }
  const actions = summarizeActions(turn.actions, targetRoot(target));
  events.push({
    ...base,
    external_id: `${threadKey}:actions`,
    occurred_at: shiftIso(finishedAt, 1),
    participants: [SYSTEM_PARTICIPANT, targetParticipant(target, "agent")],
    body_text: clipMiddle(
      `Turno ${turnIndex} da sessão ${sessionId} (${runtime}) em ${targetLabel(target)}, reconstruído do transcript — sem registro no histórico de execuções do claudemar.\n\n${actions || "- Nenhuma ação de escrita, comando ou ferramenta registrada."}`,
    ),
  });
  return events;
}
