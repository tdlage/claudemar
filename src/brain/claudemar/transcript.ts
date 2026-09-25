import type { AgentRuntime } from "../../providers/llm.js";
import type { ToolAction } from "./actions.js";

export type TranscriptEntry =
  | { kind: "user"; at: string | null; text: string }
  | { kind: "assistant"; at: string | null; text: string }
  | { kind: "action"; at: string | null; action: ToolAction };

export interface Transcript {
  runtime: AgentRuntime;
  sessionId: string;
  cwd: string | null;
  entries: TranscriptEntry[];
}

export interface TranscriptTurn {
  prompt: { at: string | null; text: string };
  followUps: { at: string | null; text: string }[];
  assistant: string[];
  actions: ToolAction[];
  startedAt: string | null;
  endedAt: string | null;
}

export interface TranscriptSessionRef {
  runtime: AgentRuntime;
  sessionId: string;
  cwd: string;
  modifiedMs: number;
}

const INJECTED_TAGS = [
  "system-reminder",
  "environment_context",
  "user_instructions",
  "INSTRUCTIONS",
  "permissions instructions",
  "turn_aborted",
  "local-command-stdout",
  "local-command-stderr",
  "command-message",
  "command-name",
  "command-args",
  "bash-input",
  "bash-stdout",
  "bash-stderr",
];
const INTERRUPTION_RE = /^\[Request interrupted by user[^\]]*\]$/;
const AGENTS_MD_PREFIX_RE = /^# AGENTS\.md instructions for /;

/** Remove blocos injetados pelo CLI; bloco sem fechamento vai até o fim, porque pode conter saída de shell. */
function stripInjectedBlocks(text: string): string {
  let out = text;
  for (const tag of INJECTED_TAGS) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    let start = out.indexOf(open);
    while (start >= 0) {
      const end = out.indexOf(close, start + open.length);
      out = end < 0 ? out.slice(0, start) : out.slice(0, start) + out.slice(end + close.length);
      start = out.indexOf(open, start);
    }
  }
  return out;
}

export function cleanUserText(text: string): string {
  const cleaned = stripInjectedBlocks(text).trim();
  if (!cleaned || INTERRUPTION_RE.test(cleaned) || AGENTS_MD_PREFIX_RE.test(cleaned)) return "";
  return cleaned;
}

export function splitTurns(transcript: Transcript): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let current: TranscriptTurn | null = null;
  for (const entry of transcript.entries) {
    if (entry.kind === "user") {
      current = {
        prompt: { at: entry.at, text: entry.text },
        followUps: [],
        assistant: [],
        actions: [],
        startedAt: entry.at,
        endedAt: entry.at,
      };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    if (entry.kind === "assistant") current.assistant.push(entry.text);
    else current.actions.push(entry.action);
    if (entry.at) current.endedAt = entry.at;
  }
  return turns;
}

export function normalizePrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 400);
}

const MIN_PREFIX_MATCH = 30;

function samePrompt(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_PREFIX_MATCH && longer.startsWith(shorter);
}

export function mergeTurns(turns: TranscriptTurn[]): TranscriptTurn | null {
  if (turns.length === 0) return null;
  const [first, ...rest] = turns;
  return {
    prompt: first.prompt,
    followUps: [...first.followUps, ...rest.flatMap((t) => [t.prompt, ...t.followUps])],
    assistant: turns.flatMap((t) => t.assistant),
    actions: turns.flatMap((t) => t.actions),
    startedAt: first.startedAt,
    endedAt: rest.length > 0 ? rest[rest.length - 1].endedAt : first.endedAt,
  };
}

const FOLLOW_UP_GRACE_MS = 60_000;

/**
 * Casa cada execução (em ordem) com o turno do transcript cujo prompt coincide. Os turnos seguintes até o próximo
 * prompt casado — mensagens digitadas durante a execução, respostas a perguntas — ficam com ela, desde que tenham
 * começado antes do fim da execução: depois disso pertencem a uma execução ainda sem registro.
 */
export function matchTurnsToPrompts(
  turns: TranscriptTurn[],
  prompts: string[],
  endsAt: (string | null)[] = [],
): (TranscriptTurn | null)[] {
  const starts: (number | null)[] = [];
  let cursor = 0;
  for (const prompt of prompts) {
    const needle = normalizePrompt(prompt);
    let found: number | null = null;
    for (let i = cursor; i < turns.length; i++) {
      if (samePrompt(normalizePrompt(turns[i].prompt.text), needle)) {
        found = i;
        break;
      }
    }
    starts.push(found);
    if (found !== null) cursor = found + 1;
  }
  return starts.map((start, index) => {
    if (start === null) return null;
    const next = starts.slice(index + 1).find((s): s is number => s !== null) ?? turns.length;
    const limit = endsAt[index] ? Date.parse(endsAt[index]!) + FOLLOW_UP_GRACE_MS : Number.POSITIVE_INFINITY;
    const owned = turns
      .slice(start, next)
      .filter((turn, i) => i === 0 || !turn.startedAt || Date.parse(turn.startedAt) <= limit);
    return mergeTurns(owned);
  });
}
