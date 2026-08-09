import { ensureBrainTree } from "./paths.js";
import { ensureBrainRepo, flushBrainGit } from "./git.js";
import { seedContract } from "./contract.js";
import { cancelBackfill, reconcileBackfillState } from "./backfill.js";
import { flushIndexRegeneration } from "./wiki.js";
import { closeRedis, ensureConsumerGroup, redisWatchdog } from "./redis.js";
import { brainSettingsManager } from "./settings.js";
import { brainSchedulers } from "./schedulers.js";
import "./triage.js";
import "./compile.js";
import "./indexer.js";
import "./digest.js";
import "./distill.js";
import "./lint.js";
import "./freshness.js";
import "./connectors/whatsapp.js";
import { slackManager } from "./connectors/slack.js";

function step(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[brain] ${label} falhou:`, err instanceof Error ? err.message : String(err));
  }
}

export async function brainInit(): Promise<void> {
  step("criação da árvore de diretórios", ensureBrainTree);
  step("bootstrap do repositório git", ensureBrainRepo);
  step("seed do contrato", seedContract);
  await reconcileBackfillState().catch(() => {});
  void redisWatchdog.start();
  await ensureConsumerGroup().catch((err) => {
    console.error("[brain] Falha ao criar consumer group:", err instanceof Error ? err.message : String(err));
  });
  brainSchedulers.start();
}

const SHUTDOWN_TIMEOUT_MS = 20_000;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([
    promise.catch(() => {}),
    new Promise((done) => {
      const timer = setTimeout(done, ms);
      timer.unref();
    }),
  ]);
}

export async function brainShutdown(): Promise<void> {
  await cancelBackfill().catch(() => {});
  await withTimeout(brainSchedulers.stop(), SHUTDOWN_TIMEOUT_MS);
  await slackManager.stop().catch(() => {});
  redisWatchdog.stop();
  await withTimeout(flushIndexRegeneration(), SHUTDOWN_TIMEOUT_MS);
  await withTimeout(flushBrainGit(), SHUTDOWN_TIMEOUT_MS);
  brainSettingsManager.flush();
  closeRedis();
}
