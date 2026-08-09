import matter from "gray-matter";
import { dump } from "js-yaml";
import { z } from "zod";
import type { RawFrontmatter, WikiFrontmatter } from "./types.js";

const participantSchema = z.object({
  name: z.string(),
  handle: z.string(),
  role: z.string(),
});

const attachmentSchema = z.object({
  name: z.string(),
  bytes: z.number(),
  sha256: z.string(),
  uri: z.string(),
});

const triageSchema = z.object({
  relevance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  tenant: z.enum(["personal", "biosoft"]),
  contains_pii: z.union([z.literal(0), z.literal(1)]),
  reason: z.string(),
  entities: z.array(z.string()),
  projects: z.array(z.string()),
  has_commitment: z.boolean(),
  has_deadline: z.boolean(),
  action_required: z.boolean(),
  classified_at: z.string(),
  model: z.string(),
});

export const rawFrontmatterSchema = z.object({
  id: z.string(),
  channel: z.enum(["email", "calendar", "whatsapp", "slack", "drive"]),
  subchannel: z.enum(["direct", "group"]),
  account: z.string(),
  thread_key: z.string(),
  tenant: z.enum(["personal", "biosoft", "unknown"]),
  contains_pii: z.union([z.literal(0), z.literal(1)]),
  occurred_from: z.string(),
  occurred_to: z.string(),
  ingested_at: z.string(),
  participants: z.array(participantSchema),
  subject: z.string(),
  message_count: z.number(),
  chatter_filtered: z.number(),
  attachments: z.array(attachmentSchema),
  raw_ref: z.string().optional(),
  triage: triageSchema.optional(),
  compiled_into: z.array(z.string()).optional(),
});

export const wikiFrontmatterSchema = z.object({
  type: z.enum(["person", "org", "project", "topic", "thread", "lesson", "procedure", "decision"]),
  slug: z.string(),
  title: z.string(),
  tenant: z.enum(["personal", "biosoft"]),
  contains_pii: z.union([z.literal(0), z.literal(1)]),
  aliases: z.array(z.string()),
  status: z.enum(["active", "dormant", "archived"]),
  created_at: z.string(),
  updated_at: z.string(),
  reviewed_at: z.string(),
  review_window: z.string(),
  half_life: z.string(),
  salience: z.number(),
  related: z.array(z.string()),
  sources: z.array(z.string()).min(1),
  independent_sources: z.number(),
  confidence: z.enum(["low", "medium", "high"]),
  pinned: z.boolean(),
});

const RAW_KEY_ORDER: (keyof RawFrontmatter)[] = [
  "id",
  "channel",
  "subchannel",
  "account",
  "thread_key",
  "tenant",
  "contains_pii",
  "occurred_from",
  "occurred_to",
  "ingested_at",
  "participants",
  "subject",
  "message_count",
  "chatter_filtered",
  "attachments",
  "raw_ref",
  "triage",
  "compiled_into",
];

const WIKI_KEY_ORDER: (keyof WikiFrontmatter)[] = [
  "type",
  "slug",
  "title",
  "tenant",
  "contains_pii",
  "aliases",
  "status",
  "created_at",
  "updated_at",
  "reviewed_at",
  "review_window",
  "half_life",
  "salience",
  "related",
  "sources",
  "independent_sources",
  "confidence",
  "pinned",
];

function orderedRecord<T extends object>(data: T, order: (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    const value = data[key];
    if (value !== undefined) out[key as string] = value;
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(key in out) && value !== undefined) out[key] = value;
  }
  return out;
}

const PARTICIPANT_ORDER = ["name", "handle", "role"];
const ATTACHMENT_ORDER = ["name", "bytes", "sha256", "uri"];
const TRIAGE_ORDER = [
  "relevance",
  "tenant",
  "contains_pii",
  "reason",
  "entities",
  "projects",
  "has_commitment",
  "has_deadline",
  "action_required",
  "classified_at",
  "model",
];

function orderKeys(obj: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) if (obj[key] !== undefined) out[key] = obj[key];
  for (const [key, value] of Object.entries(obj)) if (!(key in out) && value !== undefined) out[key] = value;
  return out;
}

function canonicalizeRaw(record: Record<string, unknown>): Record<string, unknown> {
  const out = { ...record };
  if (Array.isArray(out.participants)) {
    out.participants = out.participants.map((p) => orderKeys(p as Record<string, unknown>, PARTICIPANT_ORDER));
  }
  if (Array.isArray(out.attachments)) {
    out.attachments = out.attachments.map((a) => orderKeys(a as Record<string, unknown>, ATTACHMENT_ORDER));
  }
  if (out.triage && typeof out.triage === "object") {
    out.triage = orderKeys(out.triage as Record<string, unknown>, TRIAGE_ORDER);
  }
  return out;
}

function serialize(data: Record<string, unknown>, body: string): string {
  const yaml = dump(data, { lineWidth: -1, noRefs: true });
  return `---\n${yaml}---\n\n${body.trimEnd()}\n`;
}

export function parseRawFile(content: string): { frontmatter: RawFrontmatter; body: string } | null {
  try {
    const parsed = matter(content);
    const fm = rawFrontmatterSchema.parse(parsed.data);
    return { frontmatter: fm as RawFrontmatter, body: parsed.content.replace(/^\n+/, "") };
  } catch {
    return null;
  }
}

export function serializeRawFile(frontmatter: RawFrontmatter, body: string): string {
  return serialize(canonicalizeRaw(orderedRecord(frontmatter, RAW_KEY_ORDER)), body);
}

export function parseWikiFile(content: string): { frontmatter: WikiFrontmatter; body: string } | null {
  try {
    const parsed = matter(content);
    const fm = wikiFrontmatterSchema.parse(parsed.data);
    return { frontmatter: fm as WikiFrontmatter, body: parsed.content.replace(/^\n+/, "") };
  } catch {
    return null;
  }
}

export function parseWikiFrontmatterLoose(content: string): { data: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(content);
    return { data: parsed.data as Record<string, unknown>, body: parsed.content.replace(/^\n+/, "") };
  } catch {
    return { data: {}, body: content };
  }
}

export function serializeWikiFile(frontmatter: WikiFrontmatter, body: string): string {
  return serialize(orderedRecord(frontmatter, WIKI_KEY_ORDER), body);
}
