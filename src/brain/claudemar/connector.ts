import { query } from "../../database.js";
import {
  countHistoryStartedSince,
  loadHistoryFinishedSince,
  loadHistoryStartedBetween,
  loadSessionPrompts,
  sessionsWithHistory,
  type HistoryEntry,
} from "../../history.js";
import type { AgentRuntime } from "../../providers/llm.js";
import { emitCanonicalEvent } from "../canonical.js";
import { emitActivity } from "../events.js";
import { brainKeys, getRedis, incrMetric } from "../redis.js";
import { brainSchedulers } from "../schedulers.js";
import { brainSettings } from "../settings.js";
import { sha256Hex } from "../text.js";
import type { BrainScope } from "../scope.js";
import type { CanonicalEvent } from "../types.js";
import { claudemarAccess, type ClaudemarAccess } from "./access.js";
import { listClaudeSessions, readClaudeTranscript } from "./claude-transcript.js";
import { listCodexSessions, readCodexTranscript } from "./codex-transcript.js";
import { commitEvent, readCommits, targetRepos, type TargetRepo } from "./commits.js";
import { buildExecutionEvents, buildOrphanTurnEvents } from "./execution-events.js";
import { CLAUDEMAR_ACCOUNT } from "./managed.js";
import { syncTargetPage, targetContextEvent } from "./pages.js";
import { createRedactor, redactDeep, type Redactor } from "./redact.js";
import {
  cardEvents,
  cardFingerprint,
  cardStatus,
  cardThreadKey,
  loadPipelineCards,
  type PipelineCard,
} from "./pipeline.js";
import {
  isTargetExcluded,
  parseTargetKey,
  targetFromCwd,
  targetFromExecution,
  targetFromParticipants,
  targetHandle,
  targetKey,
  targetLabel,
  type ClaudemarTarget,
} from "./targets.js";
import { matchTurnsToPrompts, splitTurns, type Transcript, type TranscriptTurn } from "./transcript.js";

const EXEC_BATCH = 200;
const EXEC_MAX_PAGES = 50;
const EXEC_OVERLAP_MS = 15 * 60_000;
const DONE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const ORPHAN_IDLE_MS = 30 * 60_000;
const DIRTY_SETTLE_MS = 20_000;
const COMMIT_OVERLAP_MS = 60 * 60_000;
const LIVE_COMMITS_PER_REPO = 500;
const BACKFILL_COMMITS_PER_WINDOW = 2000;
const SNAPSHOT_TTL_MS = 5 * 60_000;

const GATE_INTERVALS = {
  targets: 30 * 60_000,
  cards: 5 * 60_000,
  commits: 15 * 60_000,
  orphans: 30 * 60_000,
  pagesFull: 6 * 60 * 60_000,
} as const;

const CARDS_INITIALIZED = "cards-initialized";

type Gate = keyof typeof GATE_INTERVALS;

export interface ClaudemarTickSummary {
  executions: number;
  orphans: number;
  cards: number;
  commits: number;
  targets: number;
  pages: number;
}

function emptySummary(): ClaudemarTickSummary {
  return { executions: 0, orphans: 0, cards: 0, commits: 0, targets: 0, pages: 0 };
}

async function gateDue(scope: BrainScope, name: Gate): Promise<boolean> {
  const last = Number(await getRedis().hget(brainKeys(scope).cmGates, name)) || 0;
  return Date.now() - last >= GATE_INTERVALS[name];
}

async function gateDone(scope: BrainScope, name: Gate): Promise<void> {
  await getRedis().hset(brainKeys(scope).cmGates, name, String(Date.now()));
}

function admitted(scope: BrainScope, access: ClaudemarAccess, target: ClaudemarTarget): boolean {
  return access.allows(target) && !isTargetExcluded(scope, target);
}

/**
 * Único ponto de saída do conector: descarta eventos de alvo excluído ou fora do acesso do dono e aplica a redação
 * final. As fontes já chegam redigidas (antes de qualquer truncamento); esta passagem cobre o que os construtores acrescentam.
 */
async function emitEvents(scope: BrainScope, access: ClaudemarAccess, events: CanonicalEvent[], redact: Redactor): Promise<number> {
  let emitted = 0;
  for (const event of events) {
    const target = targetFromParticipants(event.participants);
    if (!target || !admitted(scope, access, target)) continue;
    const safe = { ...event, subject: redact(event.subject), body_text: redact(event.body_text) };
    if ((await emitCanonicalEvent(scope, safe)) === "emitted") emitted += 1;
  }
  if (emitted > 0) await incrMetric(scope, "events:claudemar", emitted);
  return emitted;
}

export async function markTargetsDirty(scope: BrainScope, targets: Iterable<ClaudemarTarget>): Promise<void> {
  const keys = [...new Set([...targets].filter((t) => !isTargetExcluded(scope, t)).map(targetKey))];
  if (keys.length === 0) return;
  const now = Date.now();
  await getRedis().zadd(brainKeys(scope).cmDirtyTargets, ...keys.flatMap((key) => [now, key]));
}

/** O id do evento de contexto muda a cada alteração, inclusive quando o conteúdo volta a uma versão anterior. */
async function ensureTargetContexts(
  scope: BrainScope,
  access: ClaudemarAccess,
  targets: Iterable<ClaudemarTarget>,
  redact: Redactor,
): Promise<number> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  let emitted = 0;
  for (const target of targets) {
    if (!admitted(scope, access, target)) continue;
    const event = await targetContextEvent(scope, target);
    const key = targetKey(target);
    const hash = sha256Hex(event.body_text).slice(0, 16);
    const [storedHash, storedVersion] = ((await redis.hget(keys.cmTargetHashes, key)) ?? "").split("|");
    if (storedHash === hash) continue;
    const version = (Number(storedVersion) || 0) + 1;
    emitted += await emitEvents(scope, access, [{ ...event, external_id: `${event.thread_key}:${hash}:${version}` }], redact);
    await redis.hset(keys.cmTargetHashes, key, `${hash}|${version}`);
    await markTargetsDirty(scope, [target]);
  }
  return emitted;
}

async function readTranscript(runtime: AgentRuntime, sessionId: string): Promise<Transcript | null> {
  try {
    return runtime === "codex" ? await readCodexTranscript(sessionId) : await readClaudeTranscript(sessionId);
  } catch (err) {
    console.error(`[brain:claudemar] transcript ${runtime}:${sessionId} ilegível:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Turnos do transcript por execução, calculados sobre a sessão inteira para não casar prompts repetidos fora de ordem. */
async function sessionTurnMap(access: ClaudemarAccess, runtime: AgentRuntime, sessionId: string): Promise<Map<string, TranscriptTurn>> {
  const out = new Map<string, TranscriptTurn>();
  const transcript = await readTranscript(runtime, sessionId);
  if (!transcript) return out;
  const executions = await loadSessionPrompts(access.history, sessionId);
  const matched = matchTurnsToPrompts(
    splitTurns(transcript),
    executions.map((e) => e.prompt),
    executions.map((e) => e.completedAt),
  );
  executions.forEach((execution, index) => {
    const turn = matched[index];
    if (turn) out.set(execution.id, turn);
  });
  return out;
}

/** A consulta ao histórico já filtra pelo dono; conferir de novo aqui impede que um lote misturado vaze entre brains. */
function ownedBy(access: ClaudemarAccess, entry: HistoryEntry): boolean {
  if (access.history.kind === "user") return entry.userId === access.history.userId;
  const username = entry.username ?? "";
  return !entry.userId && (!username || username === "admin" || username.startsWith("pipeline"));
}

function ownerOnlyCard(access: ClaudemarAccess, card: PipelineCard): PipelineCard {
  return access.ownCard(card.createdBy) ? card : { ...card, intakeInput: "" };
}

export async function processExecutions(
  scope: BrainScope,
  entries: HistoryEntry[],
  redact: Redactor,
  turnCache: Map<string, Map<string, TranscriptTurn>> = new Map(),
): Promise<{ emitted: number; targets: ClaudemarTarget[] }> {
  const settings = brainSettings(scope).get().claudemar;
  const access = claudemarAccess(scope);
  const touched = new Map<string, ClaudemarTarget>();
  let emitted = 0;
  for (const entry of entries) {
    const target = targetFromExecution(entry.targetType, entry.targetName);
    if (!target || !admitted(scope, access, target) || !ownedBy(access, entry)) continue;
    let turn: TranscriptTurn | null = null;
    if (settings.transcripts && entry.sessionId) {
      const runtime = entry.runtime ?? "claude";
      const cacheKey = `${runtime}:${entry.sessionId}`;
      let turns = turnCache.get(cacheKey);
      if (!turns) {
        turns = await sessionTurnMap(access, runtime, entry.sessionId);
        turnCache.set(cacheKey, turns);
      }
      turn = turns.get(entry.id) ?? null;
    }
    emitted += await emitEvents(
      scope,
      access,
      await buildExecutionEvents(redactDeep(entry, redact), target, turn ? redactDeep(turn, redact) : null),
      redact,
    );
    touched.set(targetKey(target), target);
  }
  return { emitted, targets: [...touched.values()] };
}

function activityAt(entry: HistoryEntry): string {
  return entry.completedAt ?? entry.startedAt;
}

async function pollExecutions(scope: BrainScope, access: ClaudemarAccess, redact: Redactor): Promise<number> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const cursor = await redis.get(keys.cmExecCursor);
  if (!cursor) {
    await redis.set(keys.cmExecCursor, new Date().toISOString());
    return 0;
  }
  let since = new Date(Date.parse(cursor) - EXEC_OVERLAP_MS).toISOString();
  let latest = cursor;
  let emitted = 0;
  const turnCache = new Map<string, Map<string, TranscriptTurn>>();
  for (let page = 0; page < EXEC_MAX_PAGES; page++) {
    const rows = await loadHistoryFinishedSince(access.history, since, EXEC_BATCH);
    if (rows.length === 0) break;
    const scores = await Promise.all(rows.map((row) => redis.zscore(keys.cmExecDone, row.id)));
    const fresh = rows.filter((_, i) => scores[i] === null);
    if (fresh.length > 0) {
      const result = await processExecutions(scope, fresh, redact, turnCache);
      emitted += result.emitted;
      await ensureTargetContexts(scope, access, result.targets, redact);
      await markTargetsDirty(scope, result.targets);
      await redis.zadd(keys.cmExecDone, ...fresh.flatMap((row) => [Date.now(), row.id]));
    }
    const last = activityAt(rows[rows.length - 1]);
    if (last > latest) latest = last;
    if (rows.length < EXEC_BATCH || last === since) break;
    since = last;
  }
  await redis.set(keys.cmExecCursor, latest);
  await redis.zremrangebyscore(keys.cmExecDone, 0, Date.now() - DONE_RETENTION_MS);
  return emitted;
}

interface StoredCardState {
  h: string;
  s: string;
  t: string;
  n: string;
}

function parseCardState(raw: string | undefined): StoredCardState | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCardState;
  } catch {
    return null;
  }
}

let cardsCache: { cards: PipelineCard[]; at: number } | null = null;

async function pipelineCards(fresh: boolean): Promise<PipelineCard[]> {
  if (!fresh && cardsCache && Date.now() - cardsCache.at < SNAPSHOT_TTL_MS) return cardsCache.cards;
  const cards = await loadPipelineCards();
  cardsCache = { cards, at: Date.now() };
  return cards;
}

async function syncCards(scope: BrainScope, access: ClaudemarAccess, mode: "live" | "backfill", redact: Redactor): Promise<number> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const cards = await pipelineCards(true);
  const baseline = mode === "live" && !(await redis.hget(keys.cmGates, CARDS_INITIALIZED));
  const stored = (await redis.hgetall(keys.cmCardHashes)) as Record<string, string>;
  const seen = new Set<string>();
  const dirty = new Map<string, ClaudemarTarget>();
  let emitted = 0;

  for (const raw of cards) {
    const target = parseTargetKey(`project:${raw.projectName}`);
    if (!target || !access.cards(target)) continue;
    const card = redactDeep(ownerOnlyCard(access, raw), redact);
    const key = `card:${card.id}`;
    seen.add(key);
    const status = cardStatus(card);
    const fingerprint = cardFingerprint(card);
    const prev = parseCardState(stored[key]);
    if (prev?.h === fingerprint && mode === "live") continue;
    if (!baseline) emitted += await emitEvents(scope, access, cardEvents(card, target, { statusChanged: !prev || prev.s !== status }), redact);
    const subject = `[pipeline ${card.projectName} #${card.seq}] ${card.title}`;
    await redis.hset(keys.cmCardHashes, key, JSON.stringify({ h: fingerprint, s: status, t: targetKey(target), n: subject }));
    dirty.set(targetKey(target), target);
  }

  for (const [key, raw] of Object.entries(stored)) {
    if (seen.has(key)) continue;
    const prev = parseCardState(raw);
    const target = prev ? parseTargetKey(prev.t) : null;
    if (key.startsWith("card:") && prev && target && !baseline && access.cards(target)) {
      const threadKey = cardThreadKey(key.slice("card:".length));
      emitted += await emitEvents(
        scope,
        access,
        [
          {
            channel: "claudemar",
            subchannel: "direct",
            account: CLAUDEMAR_ACCOUNT,
            external_id: `${threadKey}:deleted`,
            thread_key: threadKey,
            occurred_at: new Date().toISOString(),
            participants: [{ name: targetLabel(target), handle: targetHandle(target), role: "agent" }],
            subject: prev.n,
            body_text: `Card removido do pipeline (último status: ${prev.s}).`,
            attachments: [],
          },
        ],
        redact,
      );
      dirty.set(prev.t, target);
    }
    await redis.hdel(keys.cmCardHashes, key);
  }

  if (baseline) await redis.hset(keys.cmGates, CARDS_INITIALIZED, String(Date.now()));
  await ensureTargetContexts(scope, access, dirty.values(), redact);
  await markTargetsDirty(scope, dirty.values());
  return emitted;
}

function repoCursorKey(repo: TargetRepo): string {
  return `${targetKey(repo.target)}|${repo.path}`;
}

async function allRepos(access: ClaudemarAccess): Promise<TargetRepo[]> {
  const repos: TargetRepo[] = [];
  for (const target of access.targets.filter((t) => access.commits(t))) repos.push(...(await targetRepos(target)));
  return repos;
}

async function emitRepoCommits(
  scope: BrainScope,
  access: ClaudemarAccess,
  repo: TargetRepo,
  since: string,
  until: string | null,
  max: number,
  redact: Redactor,
): Promise<{ emitted: number; latest: string | null }> {
  const commits = await readCommits(repo, since, until, max);
  const emitted = await emitEvents(scope, access, commits.map((commit) => commitEvent(repo, redactDeep(commit, redact))), redact);
  const latest = commits.reduce<string | null>((acc, c) => (!acc || c.committedAt > acc ? c.committedAt : acc), null);
  return { emitted, latest };
}

/** O cursor avança também para alvos excluídos: reincluir um alvo não despeja no brain o que foi feito enquanto excluído. */
async function pollCommits(scope: BrainScope, access: ClaudemarAccess, redact: Redactor): Promise<number> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  let emitted = 0;
  for (const repo of await allRepos(access)) {
    const key = repoCursorKey(repo);
    const cursor = await redis.hget(keys.cmCommitCursor, key);
    if (!cursor || isTargetExcluded(scope, repo.target)) {
      await redis.hset(keys.cmCommitCursor, key, new Date().toISOString());
      continue;
    }
    try {
      const since = new Date(Date.parse(cursor) - COMMIT_OVERLAP_MS).toISOString();
      const result = await emitRepoCommits(scope, access, repo, since, null, LIVE_COMMITS_PER_REPO, redact);
      emitted += result.emitted;
      if (result.emitted > 0) await markTargetsDirty(scope, [repo.target]);
      if (result.latest && result.latest > cursor) await redis.hset(keys.cmCommitCursor, key, result.latest);
    } catch (err) {
      console.error(`[brain:${scope.owner}:claudemar]`, err instanceof Error ? err.message : String(err));
    }
  }
  return emitted;
}

async function emitOrphanSessions(
  scope: BrainScope,
  access: ClaudemarAccess,
  sinceMs: number,
  redact: Redactor,
): Promise<{ emitted: number; targets: ClaudemarTarget[] }> {
  const idleBefore = Date.now() - ORPHAN_IDLE_MS;
  const refs = [...(await listClaudeSessions(sinceMs)), ...(await listCodexSessions(sinceMs))].filter(
    (ref) => ref.modifiedMs <= idleBefore,
  );
  const withTarget: { ref: (typeof refs)[number]; target: ClaudemarTarget }[] = [];
  for (const ref of refs) {
    const target = await targetFromCwd(ref.cwd).catch(() => null);
    if (target && admitted(scope, access, target)) withTarget.push({ ref, target });
  }
  const known = await sessionsWithHistory(withTarget.map((w) => w.ref.sessionId));
  const touched = new Map<string, ClaudemarTarget>();
  let emitted = 0;
  for (const { ref, target } of withTarget) {
    if (known.has(ref.sessionId.toLowerCase())) continue;
    const transcript = await readTranscript(ref.runtime, ref.sessionId);
    if (!transcript) continue;
    const fallbackAt = new Date(ref.modifiedMs).toISOString();
    const turns = splitTurns(transcript);
    for (const [index, turn] of turns.entries()) {
      emitted += await emitEvents(
        scope,
        access,
        buildOrphanTurnEvents(ref.runtime, ref.sessionId, index + 1, target, redactDeep(turn, redact), fallbackAt),
        redact,
      );
    }
    if (turns.length > 0) touched.set(targetKey(target), target);
  }
  return { emitted, targets: [...touched.values()] };
}

async function pollOrphans(scope: BrainScope, access: ClaudemarAccess, redact: Redactor): Promise<number> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const cursor = Number(await redis.get(keys.cmOrphanCursor)) || 0;
  const next = Date.now() - ORPHAN_IDLE_MS;
  if (!cursor) {
    await redis.set(keys.cmOrphanCursor, String(next));
    return 0;
  }
  const result = await emitOrphanSessions(scope, access, cursor - ORPHAN_IDLE_MS, redact);
  await ensureTargetContexts(scope, access, result.targets, redact);
  await markTargetsDirty(scope, result.targets);
  await redis.set(keys.cmOrphanCursor, String(next));
  return result.emitted;
}

async function syncDirtyPages(scope: BrainScope, access: ClaudemarAccess): Promise<number> {
  const redis = getRedis();
  const dirtyKey = brainKeys(scope).cmDirtyTargets;
  const keys = await redis.zrangebyscore(dirtyKey, 0, Date.now() - DIRTY_SETTLE_MS);
  if (keys.length === 0) return 0;
  const settings = brainSettings(scope).get().claudemar;
  const cards = settings.pipeline ? await pipelineCards(false) : null;
  let synced = 0;
  for (const key of keys) {
    const target = parseTargetKey(key);
    if (!target || !admitted(scope, access, target)) {
      await redis.zrem(dirtyKey, key);
      continue;
    }
    const result = await syncTargetPage(scope, target, cards);
    if (result === "waiting") continue;
    await redis.zrem(dirtyKey, key);
    if (result !== "unchanged") synced += 1;
  }
  return synced;
}

export async function claudemarTick(scope: BrainScope): Promise<ClaudemarTickSummary> {
  await query("SELECT 1");
  const settings = brainSettings(scope).get().claudemar;
  const access = claudemarAccess(scope);
  const redact = await createRedactor();
  const summary = emptySummary();
  if (await gateDue(scope, "targets")) {
    summary.targets = await ensureTargetContexts(scope, access, access.targets, redact);
    await gateDone(scope, "targets");
  }
  summary.executions = await pollExecutions(scope, access, redact);
  if (settings.pipeline && (await gateDue(scope, "cards"))) {
    summary.cards = await syncCards(scope, access, "live", redact);
    await gateDone(scope, "cards");
  }
  if (settings.commits && (await gateDue(scope, "commits"))) {
    summary.commits = await pollCommits(scope, access, redact);
    await gateDone(scope, "commits");
  }
  if (access.orphanSessions && settings.transcripts && settings.orphanSessions && (await gateDue(scope, "orphans"))) {
    summary.orphans = await pollOrphans(scope, access, redact);
    await gateDone(scope, "orphans");
  }
  if (await gateDue(scope, "pagesFull")) {
    await markTargetsDirty(scope, access.targets);
    await gateDone(scope, "pagesFull");
  }
  summary.pages = await syncDirtyPages(scope, access);
  return summary;
}

export function monthWindows(fromIso: string): { from: string; to: string }[] {
  const windows: { from: string; to: string }[] = [];
  const start = new Date(fromIso);
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const now = Date.now();
  while (cursor.getTime() < now) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    windows.push({
      from: new Date(Math.max(cursor.getTime(), start.getTime())).toISOString(),
      to: new Date(Math.min(next.getTime(), now)).toISOString(),
    });
    cursor = next;
  }
  return windows;
}

export async function backfillExecutionsWindow(
  scope: BrainScope,
  fromIso: string,
  toIso: string,
  cancelled: () => Promise<boolean>,
): Promise<number> {
  const redact = await createRedactor();
  const access = claudemarAccess(scope);
  const keys = brainKeys(scope);
  let afterId: string | null = null;
  let emitted = 0;
  const turnCache = new Map<string, Map<string, TranscriptTurn>>();
  const targets = new Map<string, ClaudemarTarget>();
  for (;;) {
    if (await cancelled()) break;
    const rows = await loadHistoryStartedBetween(access.history, fromIso, toIso, afterId, EXEC_BATCH);
    if (rows.length === 0) break;
    const result = await processExecutions(scope, rows, redact, turnCache);
    emitted += result.emitted;
    for (const target of result.targets) targets.set(targetKey(target), target);
    await getRedis().zadd(keys.cmExecDone, ...rows.flatMap((row) => [Date.now(), row.id]));
    afterId = rows[rows.length - 1].id;
    if (rows.length < EXEC_BATCH) break;
  }
  await ensureTargetContexts(scope, access, targets.values(), redact);
  await markTargetsDirty(scope, targets.values());
  return emitted;
}

export async function backfillClaudemarExtras(
  scope: BrainScope,
  sinceIso: string,
  cancelled: () => Promise<boolean>,
  progress: (detail: string) => Promise<void>,
): Promise<ClaudemarTickSummary> {
  const redis = getRedis();
  const keys = brainKeys(scope);
  const settings = brainSettings(scope).get().claudemar;
  const access = claudemarAccess(scope);
  const redact = await createRedactor();
  const summary = emptySummary();
  await progress("claudemar: contexto dos projetos e agentes");
  summary.targets = await ensureTargetContexts(scope, access, access.targets, redact);

  if (settings.pipeline && !(await cancelled())) {
    await progress("claudemar: cards do pipeline");
    summary.cards = await syncCards(scope, access, "backfill", redact);
    await redis.hset(keys.cmGates, CARDS_INITIALIZED, String(Date.now()));
  }

  if (settings.commits && !(await cancelled())) {
    const failures: string[] = [];
    for (const repo of await allRepos(access)) {
      if (await cancelled()) break;
      if (isTargetExcluded(scope, repo.target)) continue;
      await progress(`claudemar: commits de ${targetLabel(repo.target)} (${repo.name === "." ? "raiz" : repo.name})`);
      let latest: string | null = null;
      let failed = false;
      for (const window of monthWindows(sinceIso)) {
        try {
          const result = await emitRepoCommits(scope, access, repo, window.from, window.to, BACKFILL_COMMITS_PER_WINDOW, redact);
          summary.commits += result.emitted;
          if (result.latest && (!latest || result.latest > latest)) latest = result.latest;
        } catch (err) {
          failed = true;
          failures.push(`${targetLabel(repo.target)}/${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failed) continue;
      const key = repoCursorKey(repo);
      const cursor = await redis.hget(keys.cmCommitCursor, key);
      const next = [cursor, latest, new Date().toISOString()].filter((v): v is string => Boolean(v)).sort().pop()!;
      await redis.hset(keys.cmCommitCursor, key, next);
      await markTargetsDirty(scope, [repo.target]);
    }
    if (failures.length > 0) {
      throw new Error(`git log falhou em ${failures.length} repositório(s): ${failures.slice(0, 3).join("; ")}`);
    }
  }

  if (access.orphanSessions && settings.transcripts && settings.orphanSessions && !(await cancelled())) {
    await progress("claudemar: sessões que só existem nos transcripts");
    const result = await emitOrphanSessions(scope, access, Date.parse(sinceIso), redact);
    summary.orphans = result.emitted;
    await ensureTargetContexts(scope, access, result.targets, redact);
    await markTargetsDirty(scope, result.targets);
    if (!(await redis.get(keys.cmOrphanCursor))) await redis.set(keys.cmOrphanCursor, String(Date.now() - ORPHAN_IDLE_MS));
  }

  await markTargetsDirty(scope, access.targets);
  return summary;
}

export async function prepareLiveCursor(scope: BrainScope, startedAt: string): Promise<void> {
  await getRedis().set(brainKeys(scope).cmExecCursor, startedAt, "NX");
}

export async function estimateClaudemarExecutions(scope: BrainScope, sinceIso: string): Promise<number> {
  return countHistoryStartedSince(claudemarAccess(scope).history, sinceIso);
}

export function formatTickSummary(summary: ClaudemarTickSummary): string {
  return `${summary.executions} evento(s) de execução · ${summary.orphans} de sessões avulsas · ${summary.cards} de cards do pipeline · ${summary.commits} de commits · ${summary.targets} de contexto · ${summary.pages} página(s)`;
}

brainSchedulers.register({
  name: "claudemar",
  cadenceMs: (s) => s.cadences.claudemarMs,
  run: async (scope) => {
    const summary = await claudemarTick(scope);
    const total = summary.executions + summary.orphans + summary.cards + summary.commits + summary.targets;
    if (total > 0 || summary.pages > 0) {
      emitActivity(scope, { kind: "connector", label: `claudemar: ${formatTickSummary(summary)}` });
    }
    return formatTickSummary(summary);
  },
});
