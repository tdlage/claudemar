import { canonicalEventSchema } from "./canonical.js";
import { classifyChatter } from "./chatter.js";
import { normalizeMessage } from "./normalize.js";
import { getRedis, ensureConsumerGroup, incrMetric, KEYS, pushChatterSample } from "./redis.js";
import { brainSettingsManager } from "./settings.js";
import { annotateTriage, readThread, upsertMessage } from "./raw-store.js";
import { quarantineWrite } from "./quarantine.js";
import { emitActivity } from "./events.js";
import { ROOT_TENANT, canonicalTenant, resolveTenantByHandles } from "./tenants.js";
import type { BrainTenant, CanonicalEvent } from "./types.js";

const READ_COUNT = 50;
const CONSUMER = "main";
const PENDING_MIN_IDLE_MS = 5 * 60 * 1000;
const MAX_DELIVERIES = 5;

async function tenantHintFor(event: CanonicalEvent): Promise<BrainTenant> {
  const settings = brainSettingsManager.get();
  const byDomain = await resolveTenantByHandles(event.participants.map((p) => p.handle));
  if (byDomain) return byDomain;
  if (event.channel === "whatsapp") return canonicalTenant(settings.whatsapp.tenant);
  if (event.channel === "slack") return canonicalTenant(settings.slack.tenant);
  const account = settings.accounts.find((a) => a.email === event.account.toLowerCase());
  if (account) return canonicalTenant(account.tenant);
  return ROOT_TENANT;
}

async function processEvent(event: CanonicalEvent): Promise<void> {
  const settings = brainSettingsManager.get();
  const normalized = normalizeMessage(event.body_text, event.body_html);
  const verdict = classifyChatter(normalized.text, {
    minChars: settings.chatter.minChars,
    extraConfirmations: settings.chatter.extraConfirmations,
  });

  if (verdict.chatter) {
    await incrMetric("chatter_filtered");
    await pushChatterSample({
      ts: new Date().toISOString(),
      channel: event.channel,
      threadKey: event.thread_key,
      text: normalized.text.slice(0, 200),
      rule: verdict.rule ?? "",
    });
  }

  const piiHint: 0 | 1 = event.channel === "calendar" && event.subchannel === "direct" ? 0 : 1;
  const tenantHint = await tenantHintFor(event);
  const result = await upsertMessage({
    event,
    normalizedText: normalized.text,
    lang: normalized.lang,
    chatterRule: verdict.rule,
    tenantHint,
    piiHint,
  });

  if (result.added) {
    await incrMetric(`ingested:${event.channel}`);
    emitActivity({
      kind: "ingest",
      label: `${event.channel} · ${event.subject || event.thread_key}`,
      path: result.relPath,
    });
    if (result.substantive) {
      await routeTriage(event, result.relPath, tenantHint, piiHint);
    }
  }
}

async function routeTriage(
  event: CanonicalEvent,
  relPath: string,
  tenantHint: BrainTenant,
  piiHint: 0 | 1,
): Promise<void> {
  const settings = brainSettingsManager.get();
  const bulkAsNoise = settings.emailFilter.bulkAsNoise;

  if (event.bulk && bulkAsNoise) {
    const thread = await readThread(relPath);
    const llmTriaged = thread?.frontmatter.triage && thread.frontmatter.triage.model !== "heuristic";
    if (!llmTriaged) {
      await annotateTriage(relPath, {
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
      await incrMetric("bulk_noise");
      await incrMetric("relevance:0");
      return;
    }
  }

  await getRedis().zadd(KEYS.triagePending, "NX", Date.now(), event.thread_key).catch(() => {});
}

type StreamEntry = [id: string, fields: string[]];

function entryPayload(fields: string[]): string | null {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === "e") return fields[i + 1];
  }
  return null;
}

async function handleEntry(id: string, fields: string[]): Promise<void> {
  const redis = getRedis();
  const payload = entryPayload(fields);
  try {
    const parsed = canonicalEventSchema.safeParse(payload ? JSON.parse(payload) : null);
    if (!parsed.success) {
      await quarantineWrite("malformed_event", parsed.error?.message ?? "payload inválido", payload);
      emitActivity({ kind: "quarantine", label: "evento malformado descartado do stream" });
      await redis.xack(KEYS.events, KEYS.ingestGroup, id);
      return;
    }
    await processEvent(parsed.data as CanonicalEvent);
    await redis.xack(KEYS.events, KEYS.ingestGroup, id);
  } catch (err) {
    console.error("[brain:ingest] falha ao processar evento:", err instanceof Error ? err.message : err);
  }
}

async function reclaimStale(): Promise<number> {
  const redis = getRedis();
  let handled = 0;
  {
    const pending = (await redis.xpending(
      KEYS.events,
      KEYS.ingestGroup,
      "IDLE",
      PENDING_MIN_IDLE_MS,
      "-",
      "+",
      20,
    )) as [string, string, number, number][] | null;
    if (!pending || pending.length === 0) return 0;

    for (const [id, , , deliveries] of pending) {
      const claimed = (await redis.xclaim(
        KEYS.events,
        KEYS.ingestGroup,
        CONSUMER,
        PENDING_MIN_IDLE_MS,
        id,
      )) as StreamEntry[] | null;
      const entry = claimed?.[0];
      if (!entry) continue;
      if (deliveries > MAX_DELIVERIES) {
        await quarantineWrite(
          "ingest_failed",
          `evento excedeu ${MAX_DELIVERIES} tentativas de ingestão`,
          entryPayload(entry[1]),
        );
        emitActivity({ kind: "quarantine", label: "evento enviado à quarentena após retries" });
        await redis.xack(KEYS.events, KEYS.ingestGroup, id);
      } else {
        await handleEntry(entry[0], entry[1]);
      }
      handled += 1;
    }
  }
  return handled;
}

export async function ingestTick(): Promise<{ processed: number }> {
  const redis = getRedis();
  let processed = 0;
  let response: [string, StreamEntry[]][] | null;
  try {
    response = (await redis.xreadgroup(
      "GROUP",
      KEYS.ingestGroup,
      CONSUMER,
      "COUNT",
      READ_COUNT,
      "STREAMS",
      KEYS.events,
      ">",
    )) as [string, StreamEntry[]][] | null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("NOGROUP")) throw err;
    await ensureConsumerGroup();
    return { processed };
  }

  if (response) {
    for (const [, entries] of response) {
      for (const [id, fields] of entries) {
        await handleEntry(id, fields);
        processed += 1;
      }
    }
  }
  processed += await reclaimStale();
  return { processed };
}
