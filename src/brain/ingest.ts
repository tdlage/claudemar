import { canonicalEventSchema } from "./canonical.js";
import { classifyChatter } from "./chatter.js";
import { normalizeMessage } from "./normalize.js";
import { brainKeys, getRedis, ensureConsumerGroup, incrMetric, INGEST_GROUP, pushChatterSample } from "./redis.js";
import { brainSettings } from "./settings.js";
import type { BrainScope } from "./scope.js";
import { annotateTriage, readThread, upsertMessage } from "./raw-store.js";
import { quarantineWrite } from "./quarantine.js";
import { emitActivity } from "./events.js";
import { ROOT_TENANT, canonicalTenant, resolveTenantByHandles, resolveTenantName } from "./tenants.js";
import type { BrainTenant, CanonicalEvent } from "./types.js";

const READ_COUNT = 50;
const CONSUMER = "main";
const PENDING_MIN_IDLE_MS = 5 * 60 * 1000;
const MAX_DELIVERIES = 5;

/**
 * Palpite antes da triagem, nunca a decisão final: domínio próprio primeiro, depois o nome da
 * origem (workspace do Slack, sessão do WhatsApp) e só então o contexto padrão da conta Google.
 */
async function tenantHintFor(scope: BrainScope, event: CanonicalEvent): Promise<BrainTenant> {
  const settings = brainSettings(scope).get();
  const byDomain = await resolveTenantByHandles(scope, event.participants.map((p) => p.handle));
  if (byDomain) return byDomain;
  const byOrigin = await resolveTenantName(scope, event.account);
  if (byOrigin) return byOrigin;
  const account = settings.accounts.find((a) => a.email === event.account.toLowerCase());
  if (account) return canonicalTenant(scope, account.tenant);
  return ROOT_TENANT;
}

async function processEvent(scope: BrainScope, event: CanonicalEvent): Promise<void> {
  const settings = brainSettings(scope).get();
  const normalized = normalizeMessage(event.body_text, event.body_html, {
    conversational: event.channel !== "claudemar",
  });
  const verdict = classifyChatter(normalized.text, {
    minChars: settings.chatter.minChars,
    extraConfirmations: settings.chatter.extraConfirmations,
  });

  if (verdict.chatter) {
    await incrMetric(scope, "chatter_filtered");
    await pushChatterSample(scope, {
      ts: new Date().toISOString(),
      channel: event.channel,
      threadKey: event.thread_key,
      text: normalized.text.slice(0, 200),
      rule: verdict.rule ?? "",
    });
  }

  const piiHint: 0 | 1 =
    event.channel === "claudemar" || (event.channel === "calendar" && event.subchannel === "direct") ? 0 : 1;
  const tenantHint = await tenantHintFor(scope, event);
  const result = await upsertMessage(scope, {
    event,
    normalizedText: normalized.text,
    lang: normalized.lang,
    chatterRule: verdict.rule,
    tenantHint,
    piiHint,
  });

  if (result.added) {
    await incrMetric(scope, `ingested:${event.channel}`);
    emitActivity(scope, {
      kind: "ingest",
      label: `${event.channel} · ${event.subject || event.thread_key}`,
      path: result.relPath,
    });
    if (result.substantive) {
      await routeTriage(scope, event, result.relPath, tenantHint, piiHint);
    }
  }
}

async function routeTriage(
  scope: BrainScope,
  event: CanonicalEvent,
  relPath: string,
  tenantHint: BrainTenant,
  piiHint: 0 | 1,
): Promise<void> {
  const settings = brainSettings(scope).get();
  const bulkAsNoise = settings.emailFilter.bulkAsNoise;

  if (event.bulk && bulkAsNoise) {
    const thread = await readThread(scope, relPath);
    const llmTriaged = thread?.frontmatter.triage && thread.frontmatter.triage.model !== "heuristic";
    if (!llmTriaged) {
      await annotateTriage(scope, relPath, {
        relevance: 0,
        tenant: tenantHint,
        tenant_parent: null,
        tenant_evidence: "heurística de email em massa",
        contains_pii: piiHint,
        reason: "email em massa (newsletter/notificação) — classificado por heurística, sem LLM",
        entities: [],
        projects: [],
        has_commitment: false,
        has_deadline: false,
        action_required: false,
        classified_at: new Date().toISOString(),
        model: "heuristic",
      });
      await incrMetric(scope, "bulk_noise");
      await incrMetric(scope, "relevance:0");
      return;
    }
  }

  await getRedis().zadd(brainKeys(scope).triagePending, "NX", Date.now(), event.thread_key).catch(() => {});
}

type StreamEntry = [id: string, fields: string[]];

function entryPayload(fields: string[]): string | null {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === "e") return fields[i + 1];
  }
  return null;
}

async function handleEntry(scope: BrainScope, id: string, fields: string[]): Promise<void> {
  const redis = getRedis();
  const events = brainKeys(scope).events;
  const payload = entryPayload(fields);
  try {
    const parsed = canonicalEventSchema.safeParse(payload ? JSON.parse(payload) : null);
    if (!parsed.success) {
      await quarantineWrite(scope, "malformed_event", parsed.error?.message ?? "payload inválido", payload);
      emitActivity(scope, { kind: "quarantine", label: "evento malformado descartado do stream" });
      await redis.xack(events, INGEST_GROUP, id);
      return;
    }
    await processEvent(scope, parsed.data as CanonicalEvent);
    await redis.xack(events, INGEST_GROUP, id);
  } catch (err) {
    console.error(`[brain:${scope.owner}:ingest] falha ao processar evento:`, err instanceof Error ? err.message : err);
  }
}

async function reclaimStale(scope: BrainScope): Promise<number> {
  const redis = getRedis();
  const events = brainKeys(scope).events;
  let handled = 0;
  {
    const pending = (await redis.xpending(
      events,
      INGEST_GROUP,
      "IDLE",
      PENDING_MIN_IDLE_MS,
      "-",
      "+",
      20,
    )) as [string, string, number, number][] | null;
    if (!pending || pending.length === 0) return 0;

    for (const [id, , , deliveries] of pending) {
      const claimed = (await redis.xclaim(
        events,
        INGEST_GROUP,
        CONSUMER,
        PENDING_MIN_IDLE_MS,
        id,
      )) as StreamEntry[] | null;
      const entry = claimed?.[0];
      if (!entry) continue;
      if (deliveries > MAX_DELIVERIES) {
        await quarantineWrite(
          scope,
          "ingest_failed",
          `evento excedeu ${MAX_DELIVERIES} tentativas de ingestão`,
          entryPayload(entry[1]),
        );
        emitActivity(scope, { kind: "quarantine", label: "evento enviado à quarentena após retries" });
        await redis.xack(events, INGEST_GROUP, id);
      } else {
        await handleEntry(scope, entry[0], entry[1]);
      }
      handled += 1;
    }
  }
  return handled;
}

export async function ingestTick(scope: BrainScope): Promise<{ processed: number }> {
  const redis = getRedis();
  let processed = 0;
  let response: [string, StreamEntry[]][] | null;
  try {
    response = (await redis.xreadgroup(
      "GROUP",
      INGEST_GROUP,
      CONSUMER,
      "COUNT",
      READ_COUNT,
      "STREAMS",
      brainKeys(scope).events,
      ">",
    )) as [string, StreamEntry[]][] | null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("NOGROUP")) throw err;
    await ensureConsumerGroup(scope);
    return { processed };
  }

  if (response) {
    for (const [, entries] of response) {
      for (const [id, fields] of entries) {
        await handleEntry(scope, id, fields);
        processed += 1;
      }
    }
  }
  processed += await reclaimStale(scope);
  return { processed };
}
