import { rm } from "node:fs/promises";
import { ensureBrainTree } from "./paths.js";
import { cancelBrainGit, ensureBrainRepo, flushBrainGit } from "./git.js";
import { seedContract } from "./contract.js";
import { cancelBackfill, reconcileBackfillState } from "./backfill.js";
import { cancelIndexRegeneration, flushIndexRegeneration } from "./wiki.js";
import { closeRedis, deleteBrainKeys, ensureConsumerGroup, redisWatchdog } from "./redis.js";
import { flushBrainSettings } from "./settings.js";
import { brainSchedulers } from "./schedulers.js";
import { deleteBrainIndex } from "./brain-index.js";
import { deleteStoredObjects } from "./attachments.js";
import { brainApiKeys } from "./api-keys.js";
import { ADMIN_BRAIN, adminBrain, brainExists, brainScope, forgetBrainScope, isBrainOwnerId, listBrainOwners, userBrain, type BrainScope } from "./scope.js";
import "./triage.js";
import "./compile.js";
import "./indexer.js";
import "./digest.js";
import "./distill.js";
import "./lint.js";
import "./freshness.js";
import "./claudemar/connector.js";
import { disconnectWhatsapp, syncWhatsappRegistry } from "./connectors/whatsapp.js";
import { disconnectAllSlack, slackSocket } from "./connectors/slack.js";
import { disconnectAllAccounts } from "./connectors/google-auth.js";

function step(scope: BrainScope, label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[brain:${scope.owner}] ${label} falhou:`, err instanceof Error ? err.message : String(err));
  }
}

const activations = new Map<string, Promise<void>>();

/**
 * Cria a árvore e o repositório do brain na primeira vez e liga os schedulers dele. Idempotente: é chamada
 * em toda requisição do dono e antes de entregar uma mensagem de conector ao brain.
 */
export function activateBrain(scope: BrainScope): Promise<void> {
  if (brainSchedulers.isActive(scope.owner)) return Promise.resolve();
  let pending = activations.get(scope.owner);
  if (!pending) {
    pending = (async () => {
      step(scope, "criação da árvore de diretórios", () => ensureBrainTree(scope));
      step(scope, "bootstrap do repositório git", () => ensureBrainRepo(scope));
      step(scope, "seed do contrato", () => seedContract(scope));
      await reconcileBackfillState(scope).catch(() => {});
      await ensureConsumerGroup(scope).catch((err) => {
        console.error(`[brain:${scope.owner}] Falha ao criar consumer group:`, err instanceof Error ? err.message : String(err));
      });
      brainSchedulers.activate(scope);
    })().finally(() => activations.delete(scope.owner));
    activations.set(scope.owner, pending);
  }
  return pending;
}

export async function brainInit(): Promise<void> {
  void redisWatchdog.start();
  await activateBrain(adminBrain());
  for (const owner of listBrainOwners()) {
    if (owner === ADMIN_BRAIN) continue;
    const scope = userBrain(owner);
    if (scope && brainExists(scope)) await activateBrain(scope);
  }
  brainSchedulers.start();
  void syncWhatsappRegistry(true).catch((err) => {
    console.error("[brain:whatsapp] registro de dispositivos não sincronizado:", err instanceof Error ? err.message : String(err));
  });
}

/**
 * Remove tudo o que o brain de um usuário deixou: conexões (revogadas na origem), chaves de MCP, pontos do
 * índice, anexos no bucket, chaves do Redis e as pastas. Roda depois que o usuário já não autentica mais.
 */
export async function deleteUserBrain(userId: string): Promise<void> {
  if (!isBrainOwnerId(userId) || userId === ADMIN_BRAIN) return;
  const scope = brainScope(userId);
  const report = (label: string) => (err: unknown) => {
    console.error(`[brain:${userId}] remoção: ${label} falhou:`, err instanceof Error ? err.message : String(err));
  };
  await cancelBackfill(scope).catch(report("cancelamento do backfill"));
  await brainSchedulers.deactivate(userId);
  await disconnectAllAccounts(scope).catch(report("contas Google"));
  await disconnectAllSlack(scope).catch(report("contas Slack"));
  await disconnectWhatsapp(scope).catch(report("WhatsApp"));
  brainApiKeys.revokeAll(userId);
  await deleteBrainIndex(scope).catch(report("índice"));
  await deleteStoredObjects(scope).catch(report("anexos no bucket"));
  await deleteBrainKeys(scope).catch(report("chaves do Redis"));
  cancelBrainGit(scope);
  cancelIndexRegeneration(scope);
  forgetBrainScope(userId);
  await rm(scope.root, { recursive: true, force: true });
  await rm(scope.privateDir, { recursive: true, force: true });
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
  const scopes = brainSchedulers.activeScopes();
  for (const scope of scopes) await cancelBackfill(scope).catch(() => {});
  await withTimeout(brainSchedulers.stop(), SHUTDOWN_TIMEOUT_MS);
  await slackSocket.stop().catch(() => {});
  redisWatchdog.stop();
  for (const scope of scopes) {
    await withTimeout(flushIndexRegeneration(scope), SHUTDOWN_TIMEOUT_MS);
    await withTimeout(flushBrainGit(scope), SHUTDOWN_TIMEOUT_MS);
  }
  flushBrainSettings();
  closeRedis();
}
