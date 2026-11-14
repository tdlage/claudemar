import { brainKeys, claimPending, getRedis, releaseInflight } from "./redis.js";
import { brainSettings } from "./settings.js";
import { perScope, type BrainScope } from "./scope.js";
import { listConnectedEmails } from "./connectors/google-auth.js";
import { backfillGmailRange } from "./connectors/gmail.js";
import { backfillCalendarRange } from "./connectors/calendar.js";
import { slackBackfillUnits, slackConnected, type SlackBackfillUnit } from "./connectors/slack.js";
import { ingestTick } from "./ingest.js";
import { scanRawThreads } from "./raw-scan.js";
import {
  applyTriageResult,
  buildTriageRequest,
  prefilterTriage,
  parseTriageResult,
} from "./triage.js";
import {
  buildCompileRequest,
  parseCompileOutput,
  processCompileResult,
  type BuiltCompileRequest,
} from "./compile.js";
import {
  collectStageBatch,
  runStageJson,
  stageBatchStatus,
  stageDisabledReason,
  stageSupportsBatch,
  submitStageBatch,
  type BatchRequestItem,
} from "./llm.js";
import { quarantineWrite } from "./quarantine.js";
import { emitActivity, emitBrainEvent } from "./events.js";
import { getBackfillState, idleBackfillState } from "./status.js";
import {
  backfillClaudemarExtras,
  backfillExecutionsWindow,
  estimateClaudemarExecutions,
  monthWindows,
  prepareLiveCursor,
} from "./claudemar/connector.js";
import type { BackfillState } from "./types.js";

const BATCH_CHUNK_TRIAGE = 500;
const BATCH_CHUNK_COMPILE = 100;
const BATCH_POLL_MS = 60_000;
const MAX_BATCH_POLL_ERRORS = 10;

const backfillRun = perScope((): { running: boolean } => ({ running: false }));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function persist(scope: BrainScope, state: BackfillState): Promise<void> {
  await getRedis().set(brainKeys(scope).backfillState, JSON.stringify(state)).catch(() => {});
  emitBrainEvent(scope, "backfill", state);
}

async function cancelRequested(scope: BrainScope): Promise<boolean> {
  try {
    return (await getRedis().exists(brainKeys(scope).backfillCancel)) === 1;
  } catch {
    return false;
  }
}

async function requeueTriage(scope: BrainScope, threadKey: string): Promise<void> {
  try {
    await getRedis().zadd(brainKeys(scope).triagePending, Date.now(), threadKey);
  } catch (err) {
    await quarantineWrite(
      scope,
      "triage_failed",
      `backfill: falha ao re-enfileirar triagem: ${err instanceof Error ? err.message : String(err)}`,
      null,
      threadKey,
    );
  }
}

function monthsBetween(monthsBack: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const now = new Date();
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return out;
}

async function drainIngest(scope: BrainScope): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const { processed } = await ingestTick(scope);
    if (processed === 0) break;
  }
}

function rawWindowStart(monthsRaw: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsRaw, 1)).toISOString();
}

async function runClaudemarRaw(scope: BrainScope, state: BackfillState): Promise<void> {
  const redis = getRedis();
  const doneKey = brainKeys(scope).backfillDone;
  const cancelled = (): Promise<boolean> => cancelRequested(scope);
  const since = rawWindowStart(state.monthsRaw);
  state.progress.currentAccount = "claudemar";
  await prepareLiveCursor(scope, state.startedAt ?? new Date().toISOString());
  for (const window of monthWindows(since)) {
    if (await cancelled()) return;
    const month = window.from.slice(0, 7);
    const unit = `claudemar|${month}`;
    state.progress.currentMonth = month;
    if ((await redis.sismember(doneKey, unit)) === 1) {
      state.progress.processed += 1;
      continue;
    }
    state.progress.detail = `claudemar: execuções de ${month}`;
    await persist(scope, state);
    try {
      await backfillExecutionsWindow(scope, window.from, window.to, cancelled);
      await drainIngest(scope);
      if (!(await cancelled())) await redis.sadd(doneKey, unit);
    } catch (err) {
      state.error = `claudemar ${month}: ${err instanceof Error ? err.message : String(err)}`;
    }
    state.progress.processed += 1;
    await persist(scope, state);
  }

  const extras = "claudemar|extras";
  if ((await redis.sismember(doneKey, extras)) !== 1 && !(await cancelled())) {
    try {
      await backfillClaudemarExtras(scope, since, cancelled, async (detail) => {
        state.progress.detail = detail;
        await persist(scope, state);
      });
      await drainIngest(scope);
      if (!(await cancelled())) await redis.sadd(doneKey, extras);
    } catch (err) {
      state.error = `claudemar: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  state.progress.processed += 1;
  state.progress.currentAccount = null;
  state.progress.currentMonth = null;
  await persist(scope, state);
}

async function runSlackRaw(scope: BrainScope, state: BackfillState, units: SlackBackfillUnit[]): Promise<void> {
  const redis = getRedis();
  const doneKey = brainKeys(scope).backfillDone;
  state.progress.currentAccount = "slack";
  for (const unit of units) {
    if (await cancelRequested(scope)) return;
    if ((await redis.sismember(doneKey, unit.unit)) !== 1) {
      state.progress.detail = unit.label;
      await persist(scope, state);
      try {
        await unit.run();
        await drainIngest(scope);
        await redis.sadd(doneKey, unit.unit);
      } catch (err) {
        state.error = `${unit.label}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    state.progress.processed += 1;
    await persist(scope, state);
  }
  state.progress.currentAccount = null;
}

async function runRawPhase(scope: BrainScope, state: BackfillState): Promise<void> {
  const redis = getRedis();
  const doneKey = brainKeys(scope).backfillDone;
  const cancelled = (): Promise<boolean> => cancelRequested(scope);
  state.phase = "raw";
  const months = monthsBetween(state.monthsRaw);
  const accounts = state.accounts;
  const claudemarUnits = state.claudemar ? monthWindows(rawWindowStart(state.monthsRaw)).length + 1 : 0;
  let slackUnits: SlackBackfillUnit[] = [];
  if (state.slack) {
    try {
      slackUnits = await slackBackfillUnits(scope, new Date(rawWindowStart(state.monthsRaw)));
    } catch (err) {
      state.error = `slack: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  state.progress.total = accounts.length * months.length + accounts.length + claudemarUnits + slackUnits.length;
  state.progress.processed = 0;

  for (const account of accounts) {
    state.progress.currentAccount = account;
    for (let i = 0; i < months.length; i++) {
      if (await cancelled()) return;
      const { year, month } = months[i];
      const unit = `gmail|${account}|${year}-${String(month).padStart(2, "0")}`;
      state.progress.currentMonth = `${year}-${String(month).padStart(2, "0")}`;
      if ((await redis.sismember(doneKey, unit)) === 1) {
        state.progress.processed += 1;
        continue;
      }
      const after = `${year}/${String(month).padStart(2, "0")}/01`;
      const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
      const before = `${next.year}/${String(next.month).padStart(2, "0")}/01`;
      state.progress.detail = `gmail ${account} ${state.progress.currentMonth}`;
      await persist(scope, state);
      const summary = await backfillGmailRange(scope, account, after, before, cancelled);
      await drainIngest(scope);
      if (summary.error) {
        state.error = `gmail ${account} ${state.progress.currentMonth}: ${summary.error}`;
      } else {
        await redis.sadd(doneKey, unit);
      }
      state.progress.processed += 1;
      await persist(scope, state);
    }

    const calUnit = `calendar|${account}`;
    if ((await redis.sismember(doneKey, calUnit)) !== 1) {
      if (await cancelled()) return;
      state.progress.detail = `calendar ${account}`;
      await persist(scope, state);
      const timeMin = new Date(Date.now() - state.monthsRaw * 30.44 * 86_400_000).toISOString();
      const timeMax = new Date(Date.now() + 180 * 86_400_000).toISOString();
      const summary = await backfillCalendarRange(scope, account, timeMin, timeMax);
      await drainIngest(scope);
      if (summary.error) state.error = `calendar ${account}: ${summary.error}`;
      else await redis.sadd(doneKey, calUnit);
    }
    state.progress.processed += 1;
    await persist(scope, state);
  }
  state.progress.currentAccount = null;
  state.progress.currentMonth = null;
  if (slackUnits.length > 0 && !(await cancelled())) await runSlackRaw(scope, state, slackUnits);
  if (state.claudemar && !(await cancelled())) await runClaudemarRaw(scope, state);
}

async function waitForBatch(
  scope: BrainScope,
  stage: "triage" | "compile",
  batchId: string,
  state: BackfillState,
): Promise<boolean> {
  let consecutiveErrors = 0;
  for (;;) {
    if (await cancelRequested(scope)) return false;
    try {
      const status = await stageBatchStatus(stage, batchId);
      consecutiveErrors = 0;
      state.progress.detail = `batch ${stage}: ${status.processing} em processamento, ${status.succeeded} ok, ${status.errored} erro(s)`;
      await persist(scope, state);
      if (status.status === "ended") return true;
    } catch (err) {
      consecutiveErrors += 1;
      const message = err instanceof Error ? err.message : String(err);
      state.progress.detail = `batch ${stage}: consulta falhou (${consecutiveErrors}/${MAX_BATCH_POLL_ERRORS}) — ${message}`;
      await persist(scope, state);
      if (consecutiveErrors >= MAX_BATCH_POLL_ERRORS) throw err;
    }
    await sleep(BATCH_POLL_MS);
  }
}

async function runTriagePhase(scope: BrainScope, state: BackfillState): Promise<void> {
  const keys = brainKeys(scope);
  state.phase = "triage";
  const disabled = stageDisabledReason("triage");
  if (disabled) {
    state.progress.detail = `triagem pulada: ${disabled}`;
    await persist(scope, state);
    return;
  }
  const scan = await scanRawThreads(scope);
  const pending = scan.filter((item) => item.relevance === null);
  state.progress.total = pending.length;
  state.progress.processed = 0;
  state.progress.detail = `${pending.length} thread(s) sem triagem`;
  await persist(scope, state);

  const useBatch = stageSupportsBatch("triage");
  for (let offset = 0; offset < pending.length; offset += BATCH_CHUNK_TRIAGE) {
    if (await cancelRequested(scope)) return;
    const chunk = pending.slice(offset, offset + BATCH_CHUNK_TRIAGE);
    const builtByKey = new Map<string, string>();
    const items: BatchRequestItem[] = [];
    let prefiltered = 0;
    for (const item of chunk) {
      await claimPending(keys.triagePending, keys.triageInflight, item.threadKey).catch(() => {});
      const built = await buildTriageRequest(scope, item.threadKey);
      if (built && await prefilterTriage(scope, item.threadKey, built)) {
        await releaseInflight(keys.triageInflight, item.threadKey);
        prefiltered += 1;
        state.progress.processed += 1;
      } else if (built) {
        items.push({ customId: item.threadKey, request: built.request });
        builtByKey.set(item.threadKey, built.relPath);
      } else {
        await releaseInflight(keys.triageInflight, item.threadKey);
      }
    }
    if (items.length === 0) {
      state.progress.processed += chunk.length - prefiltered;
      continue;
    }

    if (useBatch) {
      const batchId = await submitStageBatch("triage", items);
      state.progress.batchId = batchId;
      await persist(scope, state);
      const finished = await waitForBatch(scope, "triage", batchId, state);
      state.progress.batchId = null;
      if (!finished) return;
      const results = await collectStageBatch(scope, "triage", batchId, items.map((i) => i.customId));
      for (const [threadKey, result] of results) {
        const relPath = builtByKey.get(threadKey);
        if (!relPath) continue;
        if (result.ok) {
          try {
            await applyTriageResult(scope, threadKey, relPath, parseTriageResult(result.value));
          } catch {
            await requeueTriage(scope, threadKey);
          }
        } else {
          await requeueTriage(scope, threadKey);
        }
        state.progress.processed += 1;
      }
    } else {
      for (const item of items) {
        if (await cancelRequested(scope)) return;
        try {
          const raw = await runStageJson(scope, "triage", item.request);
          await applyTriageResult(scope, item.customId, builtByKey.get(item.customId)!, parseTriageResult(raw));
        } catch {
          await requeueTriage(scope, item.customId);
        }
        state.progress.processed += 1;
        if (state.progress.processed % 10 === 0) await persist(scope, state);
      }
    }
    await persist(scope, state);
  }
}

async function runCompilePhase(scope: BrainScope, state: BackfillState): Promise<void> {
  const keys = brainKeys(scope);
  state.phase = "compile";
  const settings = brainSettings(scope).get();
  if (!settings.schedulers.compile) {
    state.progress.detail = "compilação pulada: scheduler de compilação desligado";
    await persist(scope, state);
    return;
  }
  const disabled = stageDisabledReason("compile");
  if (disabled) {
    state.progress.detail = `compilação pulada: ${disabled}`;
    await persist(scope, state);
    return;
  }

  const cutoff = Date.now() - state.monthsCompile * 30.44 * 86_400_000;
  const scan = await scanRawThreads(scope);
  const eligible = scan.filter(
    (item) =>
      item.relevance !== null &&
      item.relevance >= settings.compile.minRelevance &&
      !item.compiled &&
      new Date(item.occurredTo).getTime() >= cutoff,
  );
  state.progress.total = eligible.length;
  state.progress.processed = 0;
  state.progress.detail = `${eligible.length} thread(s) para compilar`;
  await persist(scope, state);

  const useBatch = stageSupportsBatch("compile");
  for (let offset = 0; offset < eligible.length; offset += BATCH_CHUNK_COMPILE) {
    if (await cancelRequested(scope)) return;
    const chunk = eligible.slice(offset, offset + BATCH_CHUNK_COMPILE);
    const builtByKey = new Map<string, BuiltCompileRequest>();
    const items: BatchRequestItem[] = [];
    for (const item of chunk) {
      await claimPending(keys.compilePending, keys.compileInflight, item.threadKey).catch(() => {});
      const built = await buildCompileRequest(scope, item.threadKey);
      if (!("error" in built)) {
        items.push({ customId: item.threadKey, request: built.request });
        builtByKey.set(item.threadKey, built);
      } else {
        await releaseInflight(keys.compileInflight, item.threadKey);
      }
    }

    const applyOne = async (threadKey: string, raw: unknown): Promise<void> => {
      const built = builtByKey.get(threadKey);
      if (!built) return;
      try {
        await processCompileResult(scope, threadKey, built, parseCompileOutput(raw));
      } catch (err) {
        await quarantineWrite(
          scope,
          "compile_failed",
          `backfill: ${err instanceof Error ? err.message : String(err)}`,
          raw,
          threadKey,
        );
      }
    };

    if (useBatch && items.length > 0) {
      const batchId = await submitStageBatch("compile", items);
      state.progress.batchId = batchId;
      await persist(scope, state);
      const finished = await waitForBatch(scope, "compile", batchId, state);
      state.progress.batchId = null;
      if (!finished) return;
      const results = await collectStageBatch(scope, "compile", batchId, items.map((i) => i.customId));
      for (const [threadKey, result] of results) {
        if (result.ok) await applyOne(threadKey, result.value);
        else {
          await quarantineWrite(scope, "compile_failed", `backfill batch: ${result.error}`, null, threadKey);
        }
        state.progress.processed += 1;
      }
    } else {
      for (const item of items) {
        if (await cancelRequested(scope)) return;
        try {
          const raw = await runStageJson(scope, "compile", item.request);
          await applyOne(item.customId, raw);
        } catch (err) {
          await quarantineWrite(
            scope,
            "compile_failed",
            `backfill: ${err instanceof Error ? err.message : String(err)}`,
            null,
            item.customId,
          );
        }
        state.progress.processed += 1;
        if (state.progress.processed % 5 === 0) await persist(scope, state);
      }
    }
    for (const key of builtByKey.keys()) await releaseInflight(keys.compileInflight, key);
    await persist(scope, state);
  }
}

async function runBackfill(scope: BrainScope, state: BackfillState): Promise<void> {
  const keys = brainKeys(scope);
  try {
    await runRawPhase(scope, state);
    if (!(await cancelRequested(scope))) await runTriagePhase(scope, state);
    if (!(await cancelRequested(scope))) await runCompilePhase(scope, state);

    if (await cancelRequested(scope)) {
      state.status = "cancelled";
      state.progress.detail = "cancelado — watermarks preservados; iniciar de novo retoma de onde parou";
    } else {
      state.status = "done";
      state.phase = null;
      await getRedis().del(keys.backfillDone).catch(() => {});
    }
  } catch (err) {
    state.status = "error";
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.finishedAt = new Date().toISOString();
    await getRedis().del(keys.backfillCancel).catch(() => {});
    await persist(scope, state);
    emitActivity(scope, { kind: "backfill", label: `backfill ${state.status}` });
    backfillRun(scope).running = false;
  }
}

export async function startBackfill(scope: BrainScope, params: {
  monthsRaw?: number;
  monthsCompile?: number;
  accounts?: string[];
  google?: boolean;
  claudemar?: boolean;
  slack?: boolean;
}): Promise<BackfillState | { error: string }> {
  const run = backfillRun(scope);
  const keys = brainKeys(scope);
  if (run.running) return { error: "backfill já em execução" };
  run.running = true;
  try {
    const previous = await getBackfillState(scope);
    if (previous.status === "running") {
      run.running = false;
      return { error: "backfill já em execução" };
    }

    const settings = brainSettings(scope).get();
    const connected = params.google === false ? [] : listConnectedEmails(scope);
    const accounts =
      params.accounts && params.accounts.length > 0
        ? params.accounts.filter((a) => connected.includes(a.toLowerCase()))
        : connected;
    const claudemar = params.claudemar === true;
    const slack = params.slack === true && slackConnected(scope);
    if (accounts.length === 0 && !claudemar && !slack) {
      run.running = false;
      return {
        error: params.google === false ? "nenhuma fonte selecionada" : "nenhuma conta Google conectada",
      };
    }

    const paramsChanged =
      previous.monthsRaw !== (params.monthsRaw ?? settings.backfill.monthsRaw) ||
      previous.accounts.join(",") !== accounts.join(",") ||
      previous.claudemar !== claudemar ||
      previous.slack !== slack;
    if (previous.status === "done" || paramsChanged) {
      await getRedis().del(keys.backfillDone).catch(() => {});
    }

    const state: BackfillState = {
      ...idleBackfillState(),
      status: "running",
      accounts,
      claudemar,
      slack,
      monthsRaw: params.monthsRaw ?? settings.backfill.monthsRaw,
      monthsCompile: params.monthsCompile ?? settings.backfill.monthsCompile,
      startedAt: new Date().toISOString(),
    };
    await getRedis().del(keys.backfillCancel).catch(() => {});
    await persist(scope, state);
    emitActivity(scope, {
      kind: "backfill",
      label: `backfill iniciado (${accounts.length} conta(s)${slack ? " + slack" : ""}${claudemar ? " + claudemar" : ""}, ${state.monthsRaw}m raw)`,
    });
    void runBackfill(scope, state);
    return state;
  } catch (err) {
    run.running = false;
    throw err;
  }
}

export async function cancelBackfill(scope: BrainScope): Promise<BackfillState> {
  await getRedis().set(brainKeys(scope).backfillCancel, "1").catch(() => {});
  return getBackfillState(scope);
}

export async function reconcileBackfillState(scope: BrainScope): Promise<void> {
  const state = await getBackfillState(scope);
  if (state.status !== "running") return;
  state.status = "error";
  state.error = "interrompido por reinício do processo";
  state.finishedAt = new Date().toISOString();
  await persist(scope, state);
}

export interface BackfillEstimate {
  untriaged: number;
  compilable: number;
  estimatedCostUsd: number;
  triageBatch: boolean;
  compileBatch: boolean;
  claudemarExecutions: number | null;
}

export async function estimateBackfill(scope: BrainScope, monthsCompile: number, monthsRaw: number): Promise<BackfillEstimate> {
  const settings = brainSettings(scope).get();
  const scan = await scanRawThreads(scope);
  const untriaged = scan.filter((i) => i.relevance === null).length;
  const cutoff = Date.now() - monthsCompile * 30.44 * 86_400_000;
  const compilable = scan.filter(
    (i) =>
      i.relevance !== null &&
      i.relevance >= settings.compile.minRelevance &&
      !i.compiled &&
      new Date(i.occurredTo).getTime() >= cutoff,
  ).length;
  const triageBatch = stageSupportsBatch("triage");
  const compileBatch = stageSupportsBatch("compile");
  const triageCost = untriaged * 0.003 * (triageBatch ? 0.5 : 1);
  const compileCost = compilable * 0.045 * (compileBatch ? 0.5 : 1);
  const claudemarExecutions = await estimateClaudemarExecutions(scope, rawWindowStart(monthsRaw)).catch(() => null);
  return {
    untriaged,
    compilable,
    estimatedCostUsd: Math.round((triageCost + compileCost) * 100) / 100,
    triageBatch,
    compileBatch,
    claudemarExecutions,
  };
}
