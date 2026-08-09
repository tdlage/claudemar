import { claimPending, getRedis, KEYS, releaseInflight } from "./redis.js";
import { brainSettingsManager } from "./settings.js";
import { listConnectedEmails } from "./connectors/google-auth.js";
import { backfillGmailRange } from "./connectors/gmail.js";
import { backfillCalendarRange } from "./connectors/calendar.js";
import { ingestTick } from "./ingest.js";
import { scanRawThreads } from "./raw-scan.js";
import {
  applyTriageResult,
  buildTriageRequest,
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
import { brainEvents, emitActivity } from "./events.js";
import { getBackfillState, idleBackfillState } from "./status.js";
import type { BackfillState } from "./types.js";

const DONE_KEY = "brain:backfill:done";
const BATCH_CHUNK_TRIAGE = 500;
const BATCH_CHUNK_COMPILE = 100;
const BATCH_POLL_MS = 60_000;
const MAX_BATCH_POLL_ERRORS = 10;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function persist(state: BackfillState): Promise<void> {
  await getRedis().set(KEYS.backfillState, JSON.stringify(state)).catch(() => {});
  brainEvents.emit("backfill", state);
}

async function cancelRequested(): Promise<boolean> {
  try {
    return (await getRedis().exists(KEYS.backfillCancel)) === 1;
  } catch {
    return false;
  }
}

async function requeueTriage(threadKey: string): Promise<void> {
  try {
    await getRedis().zadd(KEYS.triagePending, Date.now(), threadKey);
  } catch (err) {
    await quarantineWrite(
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

async function drainIngest(): Promise<void> {
  for (let i = 0; i < 500; i++) {
    const { processed } = await ingestTick();
    if (processed === 0) break;
  }
}

async function runRawPhase(state: BackfillState): Promise<void> {
  const redis = getRedis();
  state.phase = "raw";
  const months = monthsBetween(state.monthsRaw);
  const accounts = state.accounts;
  state.progress.total = accounts.length * months.length + accounts.length;
  state.progress.processed = 0;

  for (const account of accounts) {
    state.progress.currentAccount = account;
    for (let i = 0; i < months.length; i++) {
      if (await cancelRequested()) return;
      const { year, month } = months[i];
      const unit = `gmail|${account}|${year}-${String(month).padStart(2, "0")}`;
      state.progress.currentMonth = `${year}-${String(month).padStart(2, "0")}`;
      if ((await redis.sismember(DONE_KEY, unit)) === 1) {
        state.progress.processed += 1;
        continue;
      }
      const after = `${year}/${String(month).padStart(2, "0")}/01`;
      const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
      const before = `${next.year}/${String(next.month).padStart(2, "0")}/01`;
      state.progress.detail = `gmail ${account} ${state.progress.currentMonth}`;
      await persist(state);
      const summary = await backfillGmailRange(account, after, before, cancelRequested);
      await drainIngest();
      if (summary.error) {
        state.error = `gmail ${account} ${state.progress.currentMonth}: ${summary.error}`;
      } else {
        await redis.sadd(DONE_KEY, unit);
      }
      state.progress.processed += 1;
      await persist(state);
    }

    const calUnit = `calendar|${account}`;
    if ((await redis.sismember(DONE_KEY, calUnit)) !== 1) {
      if (await cancelRequested()) return;
      state.progress.detail = `calendar ${account}`;
      await persist(state);
      const timeMin = new Date(Date.now() - state.monthsRaw * 30.44 * 86_400_000).toISOString();
      const timeMax = new Date(Date.now() + 180 * 86_400_000).toISOString();
      const summary = await backfillCalendarRange(account, timeMin, timeMax);
      await drainIngest();
      if (summary.error) state.error = `calendar ${account}: ${summary.error}`;
      else await redis.sadd(DONE_KEY, calUnit);
    }
    state.progress.processed += 1;
    await persist(state);
  }
  state.progress.currentAccount = null;
  state.progress.currentMonth = null;
}

async function waitForBatch(stage: "triage" | "compile", batchId: string, state: BackfillState): Promise<boolean> {
  let consecutiveErrors = 0;
  for (;;) {
    if (await cancelRequested()) return false;
    try {
      const status = await stageBatchStatus(stage, batchId);
      consecutiveErrors = 0;
      state.progress.detail = `batch ${stage}: ${status.processing} em processamento, ${status.succeeded} ok, ${status.errored} erro(s)`;
      await persist(state);
      if (status.status === "ended") return true;
    } catch (err) {
      consecutiveErrors += 1;
      const message = err instanceof Error ? err.message : String(err);
      state.progress.detail = `batch ${stage}: consulta falhou (${consecutiveErrors}/${MAX_BATCH_POLL_ERRORS}) — ${message}`;
      await persist(state);
      if (consecutiveErrors >= MAX_BATCH_POLL_ERRORS) throw err;
    }
    await sleep(BATCH_POLL_MS);
  }
}

async function runTriagePhase(state: BackfillState): Promise<void> {
  state.phase = "triage";
  const disabled = stageDisabledReason("triage");
  if (disabled) {
    state.progress.detail = `triagem pulada: ${disabled}`;
    await persist(state);
    return;
  }
  const scan = await scanRawThreads();
  const pending = scan.filter((item) => item.relevance === null);
  state.progress.total = pending.length;
  state.progress.processed = 0;
  state.progress.detail = `${pending.length} thread(s) sem triagem`;
  await persist(state);

  const useBatch = stageSupportsBatch("triage");
  for (let offset = 0; offset < pending.length; offset += BATCH_CHUNK_TRIAGE) {
    if (await cancelRequested()) return;
    const chunk = pending.slice(offset, offset + BATCH_CHUNK_TRIAGE);
    const builtByKey = new Map<string, string>();
    const items: BatchRequestItem[] = [];
    for (const item of chunk) {
      await claimPending(KEYS.triagePending, KEYS.triageInflight, item.threadKey).catch(() => {});
      const built = await buildTriageRequest(item.threadKey);
      if (built) {
        items.push({ customId: item.threadKey, request: built.request });
        builtByKey.set(item.threadKey, built.relPath);
      } else {
        await releaseInflight(KEYS.triageInflight, item.threadKey);
      }
    }
    if (items.length === 0) {
      state.progress.processed += chunk.length;
      continue;
    }

    if (useBatch) {
      const batchId = await submitStageBatch("triage", items);
      state.progress.batchId = batchId;
      await persist(state);
      const finished = await waitForBatch("triage", batchId, state);
      state.progress.batchId = null;
      if (!finished) return;
      const results = await collectStageBatch("triage", batchId, items.map((i) => i.customId));
      for (const [threadKey, result] of results) {
        const relPath = builtByKey.get(threadKey);
        if (!relPath) continue;
        if (result.ok) {
          try {
            await applyTriageResult(threadKey, relPath, parseTriageResult(result.value));
          } catch {
            await requeueTriage(threadKey);
          }
        } else {
          await requeueTriage(threadKey);
        }
        state.progress.processed += 1;
      }
    } else {
      for (const item of items) {
        if (await cancelRequested()) return;
        try {
          const raw = await runStageJson("triage", item.request);
          await applyTriageResult(item.customId, builtByKey.get(item.customId)!, parseTriageResult(raw));
        } catch {
          await requeueTriage(item.customId);
        }
        state.progress.processed += 1;
        if (state.progress.processed % 10 === 0) await persist(state);
      }
    }
    await persist(state);
  }
}

async function runCompilePhase(state: BackfillState): Promise<void> {
  state.phase = "compile";
  const settings = brainSettingsManager.get();
  if (!settings.schedulers.compile) {
    state.progress.detail = "compilação pulada: scheduler de compilação desligado";
    await persist(state);
    return;
  }
  const disabled = stageDisabledReason("compile");
  if (disabled) {
    state.progress.detail = `compilação pulada: ${disabled}`;
    await persist(state);
    return;
  }

  const cutoff = Date.now() - state.monthsCompile * 30.44 * 86_400_000;
  const scan = await scanRawThreads();
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
  await persist(state);

  const useBatch = stageSupportsBatch("compile");
  for (let offset = 0; offset < eligible.length; offset += BATCH_CHUNK_COMPILE) {
    if (await cancelRequested()) return;
    const chunk = eligible.slice(offset, offset + BATCH_CHUNK_COMPILE);
    const builtByKey = new Map<string, BuiltCompileRequest>();
    const items: BatchRequestItem[] = [];
    for (const item of chunk) {
      await claimPending(KEYS.compilePending, KEYS.compileInflight, item.threadKey).catch(() => {});
      const built = await buildCompileRequest(item.threadKey);
      if (!("error" in built)) {
        items.push({ customId: item.threadKey, request: built.request });
        builtByKey.set(item.threadKey, built);
      } else {
        await releaseInflight(KEYS.compileInflight, item.threadKey);
      }
    }

    const applyOne = async (threadKey: string, raw: unknown): Promise<void> => {
      const built = builtByKey.get(threadKey);
      if (!built) return;
      try {
        await processCompileResult(threadKey, built, parseCompileOutput(raw));
      } catch (err) {
        await quarantineWrite(
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
      await persist(state);
      const finished = await waitForBatch("compile", batchId, state);
      state.progress.batchId = null;
      if (!finished) return;
      const results = await collectStageBatch("compile", batchId, items.map((i) => i.customId));
      for (const [threadKey, result] of results) {
        if (result.ok) await applyOne(threadKey, result.value);
        else {
          await quarantineWrite("compile_failed", `backfill batch: ${result.error}`, null, threadKey);
        }
        state.progress.processed += 1;
      }
    } else {
      for (const item of items) {
        if (await cancelRequested()) return;
        try {
          const raw = await runStageJson("compile", item.request);
          await applyOne(item.customId, raw);
        } catch (err) {
          await quarantineWrite(
            "compile_failed",
            `backfill: ${err instanceof Error ? err.message : String(err)}`,
            null,
            item.customId,
          );
        }
        state.progress.processed += 1;
        if (state.progress.processed % 5 === 0) await persist(state);
      }
    }
    for (const key of builtByKey.keys()) await releaseInflight(KEYS.compileInflight, key);
    await persist(state);
  }
}

async function runBackfill(state: BackfillState): Promise<void> {
  try {
    await runRawPhase(state);
    if (!(await cancelRequested())) await runTriagePhase(state);
    if (!(await cancelRequested())) await runCompilePhase(state);

    if (await cancelRequested()) {
      state.status = "cancelled";
      state.progress.detail = "cancelado — watermarks preservados; iniciar de novo retoma de onde parou";
    } else {
      state.status = "done";
      state.phase = null;
      await getRedis().del(DONE_KEY).catch(() => {});
    }
  } catch (err) {
    state.status = "error";
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.finishedAt = new Date().toISOString();
    await getRedis().del(KEYS.backfillCancel).catch(() => {});
    await persist(state);
    emitActivity({ kind: "backfill", label: `backfill ${state.status}` });
    running = false;
  }
}

export async function startBackfill(params: {
  monthsRaw?: number;
  monthsCompile?: number;
  accounts?: string[];
}): Promise<BackfillState | { error: string }> {
  if (running) return { error: "backfill já em execução" };
  running = true;
  try {
    const previous = await getBackfillState();
    if (previous.status === "running") {
      running = false;
      return { error: "backfill já em execução" };
    }

    const settings = brainSettingsManager.get();
    const connected = listConnectedEmails();
    const accounts =
      params.accounts && params.accounts.length > 0
        ? params.accounts.filter((a) => connected.includes(a.toLowerCase()))
        : connected;
    if (accounts.length === 0) {
      running = false;
      return { error: "nenhuma conta Google conectada" };
    }

    const paramsChanged =
      previous.monthsRaw !== (params.monthsRaw ?? settings.backfill.monthsRaw) ||
      previous.accounts.join(",") !== accounts.join(",");
    if (previous.status === "done" || paramsChanged) {
      await getRedis().del(DONE_KEY).catch(() => {});
    }

    const state: BackfillState = {
      ...idleBackfillState(),
      status: "running",
      accounts,
      monthsRaw: params.monthsRaw ?? settings.backfill.monthsRaw,
      monthsCompile: params.monthsCompile ?? settings.backfill.monthsCompile,
      startedAt: new Date().toISOString(),
    };
    await getRedis().del(KEYS.backfillCancel).catch(() => {});
    await persist(state);
    emitActivity({
      kind: "backfill",
      label: `backfill iniciado (${accounts.length} conta(s), ${state.monthsRaw}m raw)`,
    });
    void runBackfill(state);
    return state;
  } catch (err) {
    running = false;
    throw err;
  }
}

export async function cancelBackfill(): Promise<BackfillState> {
  await getRedis().set(KEYS.backfillCancel, "1").catch(() => {});
  return getBackfillState();
}

export async function reconcileBackfillState(): Promise<void> {
  const state = await getBackfillState();
  if (state.status !== "running") return;
  state.status = "error";
  state.error = "interrompido por reinício do processo";
  state.finishedAt = new Date().toISOString();
  await persist(state);
}

export interface BackfillEstimate {
  untriaged: number;
  compilable: number;
  estimatedCostUsd: number;
  triageBatch: boolean;
  compileBatch: boolean;
}

export async function estimateBackfill(monthsCompile: number): Promise<BackfillEstimate> {
  const settings = brainSettingsManager.get();
  const scan = await scanRawThreads();
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
  return {
    untriaged,
    compilable,
    estimatedCostUsd: Math.round((triageCost + compileCost) * 100) / 100,
    triageBatch,
    compileBatch,
  };
}
