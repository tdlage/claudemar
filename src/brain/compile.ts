import { claimPending, getRedis, incrMetric, KEYS, recoverInflight, releaseInflight, requeuePending } from "./redis.js";
import { brainSettingsManager } from "./settings.js";
import { runStageJson, stageDisabledReason, type StageRequest } from "./llm.js";
import { findThreadPath, readThread } from "./raw-store.js";
import { getContract } from "./contract.js";
import { resolveEntities } from "./entities.js";
import { relatedPagesText } from "./wiki.js";
import {
  applyCompileOutput,
  compileOutputSchema,
  COMPILE_JSON_SCHEMA,
  validateCompileOutput,
} from "./operations.js";
import { quarantineWrite } from "./quarantine.js";
import { emitActivity } from "./events.js";
import { brainSchedulers } from "./schedulers.js";
import { channelOfThreadKey } from "./triage.js";
import type { CompileOutput, RawFrontmatter } from "./types.js";

const MAX_ATTEMPTS = 5;
const MAX_THREAD_CHARS = 12_000;

export interface BuiltCompileRequest {
  request: StageRequest;
  relPath: string;
  frontmatter: RawFrontmatter;
}

export async function buildCompileRequest(threadKey: string): Promise<BuiltCompileRequest | { error: string }> {
  const relPath = await findThreadPath(threadKey, channelOfThreadKey(threadKey));
  if (!relPath) return { error: "thread não encontrada em raw/" };
  const thread = await readThread(relPath);
  if (!thread) return { error: "arquivo raw ilegível" };
  if (!thread.frontmatter.triage) return { error: "thread sem triagem" };

  const settings = brainSettingsManager.get();
  const triage = thread.frontmatter.triage;
  const entityNames = [
    ...triage.entities,
    ...triage.projects,
    ...thread.frontmatter.participants.map((p) => p.name).filter(Boolean),
  ];
  const { paths } = await resolveEntities(entityNames);
  const related = await relatedPagesText(paths, settings.compile.contextPages);

  const substantive = thread.blocks.filter((b) => b.chatter === null);
  const header = [
    `Arquivo: ${relPath}`,
    `Canal: ${thread.frontmatter.channel} (${thread.frontmatter.subchannel})`,
    `Tenant: ${triage.tenant} · relevance: ${triage.relevance}`,
    `Assunto: ${thread.frontmatter.subject || "(sem assunto)"}`,
    `Participantes: ${thread.frontmatter.participants.map((p) => `${p.name} <${p.handle}>`).join(", ")}`,
  ].join("\n");

  let used = 0;
  const messages: string[] = [];
  for (const block of substantive.slice().reverse()) {
    const entry = `## [${block.at}] ${block.sender}\n${block.body}\n`;
    if (used + entry.length > MAX_THREAD_CHARS) break;
    used += entry.length;
    messages.unshift(entry);
  }

  const user = [
    related ? `# Páginas existentes do wiki relacionadas\n\n${related}` : "# Nenhuma página relacionada existente no wiki",
    `# Thread a compilar (fonte: ${relPath})\n\n${header}\n\n${messages.join("\n")}`,
    `# Tarefa\n\nCompile esta thread conforme o contrato. Use "${relPath}" como source. Atualize páginas existentes em vez de criar novas. Se nada merece extração, devolva operations vazio.`,
  ].join("\n\n");

  return {
    relPath,
    frontmatter: thread.frontmatter,
    request: {
      system: [{ text: getContract(), cacheable: true }],
      user,
      schema: COMPILE_JSON_SCHEMA,
      maxTokens: 16_000,
    },
  };
}

export function parseCompileOutput(raw: unknown): CompileOutput {
  return compileOutputSchema.parse(raw) as CompileOutput;
}

export async function processCompileResult(
  threadKey: string,
  built: BuiltCompileRequest,
  output: CompileOutput,
): Promise<boolean> {
  const validation = await validateCompileOutput(output, built.frontmatter);
  if (!validation.ok) {
    await quarantineWrite(
      "invalid_operations",
      `validação rejeitou a compilação: ${validation.errors.join(" | ")}`,
      output,
      threadKey,
    );
    emitActivity({ kind: "quarantine", label: `compilação de ${threadKey} rejeitada na validação` });
    return false;
  }
  const result = await applyCompileOutput(
    threadKey,
    built.relPath,
    output,
    built.frontmatter.contains_pii === 1 ? 1 : 0,
  );
  await incrMetric("compiled");
  emitActivity({
    kind: "compile",
    label:
      result.pages.length > 0
        ? `${result.pages.length} página(s) atualizada(s)${result.openLoops > 0 ? ` · ${result.openLoops} open-loop(s)` : ""}`
        : "nada a extrair",
    path: result.pages[0],
  });
  return true;
}

async function handleFailure(threadKey: string, err: unknown): Promise<boolean> {
  const redis = getRedis();
  const message = err instanceof Error ? err.message : String(err);
  const attempts = await redis.hincrby(KEYS.compileAttempts, threadKey, 1).catch(() => 0);
  if (attempts > MAX_ATTEMPTS) {
    await quarantineWrite("compile_failed", `compilação excedeu ${MAX_ATTEMPTS} tentativas: ${message}`, null, threadKey);
    await redis.hdel(KEYS.compileAttempts, threadKey).catch(() => {});
    emitActivity({ kind: "quarantine", label: `compilação de ${threadKey} em quarentena` });
    return true;
  }
  return false;
}

const INFLIGHT_STALE_MS = 10 * 60 * 1000;

export async function compileTick(): Promise<{ processed: number }> {
  const settings = brainSettingsManager.get();
  const redis = getRedis();
  await recoverInflight(KEYS.compilePending, KEYS.compileInflight, INFLIGHT_STALE_MS).catch(() => {});
  const threadKeys = await redis.zrange(KEYS.compilePending, "0", String(settings.compile.maxPerTick - 1));

  let processed = 0;
  for (const threadKey of threadKeys) {
    await claimPending(KEYS.compilePending, KEYS.compileInflight, threadKey);
    try {
      const built = await buildCompileRequest(threadKey);
      if ("error" in built) {
        await quarantineWrite("compile_failed", built.error, null, threadKey);
        continue;
      }
      const raw = await runStageJson("compile", built.request);
      const output = parseCompileOutput(raw);
      await processCompileResult(threadKey, built, output);
      await redis.hdel(KEYS.compileAttempts, threadKey).catch(() => {});
      processed += 1;
    } catch (err) {
      const dead = await handleFailure(threadKey, err);
      if (!dead) await requeuePending(KEYS.compilePending, threadKey);
    } finally {
      await releaseInflight(KEYS.compileInflight, threadKey);
    }
  }
  return { processed };
}

brainSchedulers.register({
  name: "compile",
  cadenceMs: (s) => s.cadences.compileMs,
  disabledReason: () => stageDisabledReason("compile"),
  run: async () => {
    const { processed } = await compileTick();
    return `${processed} compiladas`;
  },
});
