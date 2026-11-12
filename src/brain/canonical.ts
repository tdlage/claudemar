import { z } from "zod";
import { brainKeys, clearSeen, getRedis, markSeen } from "./redis.js";
import type { BrainScope } from "./scope.js";
import { sha256Hex } from "./text.js";
import type { CanonicalEvent } from "./types.js";

export const canonicalEventSchema = z.object({
  channel: z.enum(["email", "calendar", "whatsapp", "slack", "drive", "claudemar"]),
  subchannel: z.enum(["direct", "group"]),
  account: z.string().min(1),
  external_id: z.string().min(1),
  thread_key: z.string().min(1),
  occurred_at: z.string().min(1),
  participants: z.array(z.object({ name: z.string(), handle: z.string(), role: z.string() })),
  subject: z.string(),
  body_text: z.string(),
  body_html: z.string().optional(),
  attachments: z.array(
    z.object({ name: z.string(), bytes: z.number(), sha256: z.string(), uri: z.string() }),
  ),
  raw_ref: z.string().optional(),
  bulk: z.boolean().optional(),
});

const EVENTS_MAXLEN = 100_000;

export async function emitCanonicalEvent(scope: BrainScope, event: CanonicalEvent): Promise<"emitted" | "duplicate"> {
  const hash = sha256Hex(`${event.channel}:${event.external_id}`);
  const fresh = await markSeen(scope, hash);
  if (!fresh) return "duplicate";
  try {
    await getRedis().xadd(brainKeys(scope).events, "MAXLEN", "~", EVENTS_MAXLEN, "*", "e", JSON.stringify(event));
  } catch (err) {
    await clearSeen(scope, hash).catch(() => {});
    throw err;
  }
  return "emitted";
}
