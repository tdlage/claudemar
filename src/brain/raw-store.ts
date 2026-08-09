import { readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { config } from "../config.js";
import { brainRoot, rawDir } from "./paths.js";
import { brainWriteLock, writeFileAtomic } from "./git.js";
import { getRedis, KEYS } from "./redis.js";
import { parseRawFile, serializeRawFile } from "./frontmatter.js";
import { dateInTz, hash8, sha256Hex, slugify } from "./text.js";
import type {
  BrainTenant,
  CanonicalEvent,
  CanonicalParticipant,
  RawFrontmatter,
  RawMessageBlock,
  StoredAttachment,
  TriageAnnotation,
} from "./types.js";

export interface IncomingMessage {
  event: CanonicalEvent;
  normalizedText: string;
  lang: string;
  chatterRule: string | null;
  tenantHint: BrainTenant | "unknown";
  piiHint: 0 | 1;
  now?: string;
}

export interface UpsertResult {
  relPath: string;
  added: boolean;
  substantive: boolean;
  created: boolean;
}

const MARKER_RE = /^<!-- msg:(\S+) at:(\S+) from:(\S*) lang:(\S+) chatter:(\S+) -->$/;

function markerField(value: string): string {
  return value.replace(/\s+/g, "").replace(/<!--+/g, "").replace(/-->+/g, "");
}

function headerText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/<!--/g, "<!-").replace(/-->/g, "->").trim();
}

function buildBlock(msg: IncomingMessage): string {
  const { event } = msg;
  const from =
    event.participants.find((p) => p.role === "from" || p.role === "organizer") ?? event.participants[0];
  const senderName = headerText(from?.name || from?.handle || "desconhecido");
  const senderHandle = headerText(from?.handle ?? "");
  const body = msg.normalizedText.replace(/^<!-- msg:/gm, "<!-- msg :").trimEnd();
  const marker = `<!-- msg:${markerField(event.external_id)} at:${markerField(event.occurred_at)} from:${markerField(senderHandle)} lang:${markerField(msg.lang)} chatter:${markerField(msg.chatterRule ?? "-")} -->`;
  const header = `## [${event.occurred_at}] ${senderName}${senderHandle ? ` <${senderHandle}>` : ""}`;
  return `${marker}\n${header}\n\n${body}\n`;
}

export function parseBlocks(body: string): RawMessageBlock[] {
  const chunks = body.split(/^(?=<!-- msg:)/m).filter((c) => c.trim().length > 0);
  const blocks: RawMessageBlock[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const match = MARKER_RE.exec(lines[0] ?? "");
    if (!match) continue;
    const headerLine = lines[1] ?? "";
    const sender = headerLine.replace(/^## \[[^\]]*\]\s*/, "");
    blocks.push({
      externalId: match[1],
      at: match[2],
      sender,
      lang: match[4],
      chatter: match[5] === "-" ? null : match[5],
      body: lines.slice(2).join("\n").replace(/^\n+/, "").trimEnd(),
    });
  }
  return blocks;
}

function serializeBlocks(rawChunks: string[]): string {
  return rawChunks.join("\n");
}

function mergeParticipants(
  existing: CanonicalParticipant[],
  incoming: CanonicalParticipant[],
): CanonicalParticipant[] {
  const byHandle = new Map<string, CanonicalParticipant>();
  for (const p of [...existing, ...incoming]) {
    const key = p.handle.toLowerCase() || p.name.toLowerCase();
    if (!byHandle.has(key)) byHandle.set(key, { name: p.name, handle: p.handle, role: p.role });
  }
  return [...byHandle.values()].sort((a, b) =>
    (a.handle || a.name).localeCompare(b.handle || b.name, "en"),
  );
}

function mergeAttachments(existing: StoredAttachment[], incoming: StoredAttachment[]): StoredAttachment[] {
  const bySha = new Map<string, StoredAttachment>();
  for (const a of [...existing, ...incoming]) {
    if (!bySha.has(a.sha256)) bySha.set(a.sha256, a);
  }
  return [...bySha.values()].sort((a, b) => a.sha256.localeCompare(b.sha256, "en"));
}

async function findExistingPath(threadKey: string, channel: string): Promise<string | null> {
  try {
    const cached = await getRedis().hget(KEYS.threadFile, threadKey);
    if (cached && existsSync(resolve(brainRoot, cached))) return cached;
  } catch {}
  const suffix = `--${hash8(threadKey)}.md`;
  const channelDir = resolve(rawDir, channel);
  if (!existsSync(channelDir)) return null;
  try {
    const years = await readdir(channelDir);
    for (const year of years) {
      const yearDir = resolve(channelDir, year);
      const months = await readdir(yearDir).catch(() => [] as string[]);
      for (const month of months) {
        const monthDir = resolve(yearDir, month);
        const files = await readdir(monthDir).catch(() => [] as string[]);
        const found = files.find((f) => f.endsWith(suffix));
        if (found) return relative(brainRoot, resolve(monthDir, found));
      }
    }
  } catch {}
  return null;
}

function threadSlug(event: CanonicalEvent): string {
  const account = event.account.toLowerCase();
  const counterparty = event.participants.find(
    (p) => p.handle && p.handle.toLowerCase() !== account,
  );
  if (counterparty?.name) return slugify(counterparty.name);
  if (counterparty?.handle) return slugify(counterparty.handle.split("@")[0]);
  if (event.subject) return slugify(event.subject);
  return "sem-assunto";
}

function newThreadPath(event: CanonicalEvent): string {
  const occurred = new Date(event.occurred_at);
  const { yyyy, mm, dd } = dateInTz(Number.isNaN(occurred.getTime()) ? new Date() : occurred, config.brainTz);
  const name = `${yyyy}-${mm}-${dd}--${threadSlug(event)}--${hash8(event.thread_key)}.md`;
  return `raw/${event.channel}/${yyyy}/${mm}/${name}`;
}

function instantOf(at: string): number {
  const value = Date.parse(at);
  return Number.isNaN(value) ? 0 : value;
}

function compareBlocks(aAt: string, aId: string, bAt: string, bId: string): number {
  const delta = instantOf(aAt) - instantOf(bAt);
  if (delta !== 0) return delta;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

function canonicalRelPath(currentRelPath: string, occurredFrom: string, channel: string): string {
  const fileName = currentRelPath.split("/").pop() ?? "";
  const match = /^\d{4}-\d{2}-\d{2}--(.+--[0-9a-f]{8}\.md)$/.exec(fileName);
  if (!match) return currentRelPath;
  const occurred = new Date(occurredFrom);
  if (Number.isNaN(occurred.getTime())) return currentRelPath;
  const { yyyy, mm, dd } = dateInTz(occurred, config.brainTz);
  return `raw/${channel}/${yyyy}/${mm}/${yyyy}-${mm}-${dd}--${match[1]}`;
}

export async function upsertMessage(msg: IncomingMessage): Promise<UpsertResult> {
  return brainWriteLock(async () => {
    const { event } = msg;
    let relPath = await findExistingPath(event.thread_key, event.channel);
    let frontmatter: RawFrontmatter;
    let chunks: string[] = [];
    let created = false;

    if (relPath) {
      const content = await readFile(resolve(brainRoot, relPath), "utf-8");
      const parsed = parseRawFile(content);
      if (!parsed) throw new Error(`raw file ilegível: ${relPath}`);
      frontmatter = parsed.frontmatter;
      chunks = parsed.body.split(/^(?=<!-- msg:)/m).filter((c) => c.trim().length > 0);
      const blocks = parseBlocks(parsed.body);
      if (blocks.some((b) => b.externalId === event.external_id)) {
        return { relPath, added: false, substantive: false, created: false };
      }
    } else {
      created = true;
      relPath = newThreadPath(event);
      const now = msg.now ?? new Date().toISOString();
      frontmatter = {
        id: sha256Hex(event.thread_key).slice(0, 16),
        channel: event.channel,
        subchannel: event.subchannel,
        account: event.account,
        thread_key: event.thread_key,
        tenant: msg.tenantHint,
        contains_pii: msg.piiHint,
        occurred_from: event.occurred_at,
        occurred_to: event.occurred_at,
        ingested_at: now,
        participants: [],
        subject: event.subject,
        message_count: 0,
        chatter_filtered: 0,
        attachments: [],
      };
    }

    const newChunk = buildBlock(msg).trimEnd() + "\n";
    chunks.push(newChunk);
    chunks.sort((a, b) => {
      const ma = MARKER_RE.exec(a.split("\n", 1)[0] ?? "");
      const mb = MARKER_RE.exec(b.split("\n", 1)[0] ?? "");
      if (!ma || !mb) return ma ? 1 : mb ? -1 : 0;
      return compareBlocks(ma[2], ma[1], mb[2], mb[1]);
    });

    const body = serializeBlocks(chunks.map((c) => c.trimEnd() + "\n"));
    const blocks = parseBlocks(body);
    const substantiveCount = blocks.filter((b) => b.chatter === null).length;
    frontmatter.message_count = substantiveCount;
    frontmatter.chatter_filtered = blocks.length - substantiveCount;
    const dates = blocks.map((b) => b.at).sort((a, b) => instantOf(a) - instantOf(b));
    frontmatter.occurred_from = dates[0] ?? frontmatter.occurred_from;
    frontmatter.occurred_to = dates[dates.length - 1] ?? frontmatter.occurred_to;
    frontmatter.participants = mergeParticipants(frontmatter.participants, event.participants);
    frontmatter.attachments = mergeAttachments(frontmatter.attachments, event.attachments);
    if (!frontmatter.subject && event.subject) frontmatter.subject = event.subject;
    if (event.raw_ref && !frontmatter.raw_ref) frontmatter.raw_ref = event.raw_ref;
    if (event.subchannel === "group") frontmatter.subchannel = "group";

    const canonical = canonicalRelPath(relPath, frontmatter.occurred_from, event.channel);
    await writeFileAtomic(resolve(brainRoot, canonical), serializeRawFile(frontmatter, body));
    if (canonical !== relPath && !created) {
      await unlink(resolve(brainRoot, relPath)).catch(() => {});
    }
    await getRedis().hset(KEYS.threadFile, event.thread_key, canonical).catch(() => {});
    return { relPath: canonical, added: true, substantive: msg.chatterRule === null, created };
  });
}

export async function annotateTriage(relPath: string, triage: TriageAnnotation): Promise<void> {
  await brainWriteLock(async () => {
    const abs = resolve(brainRoot, relPath);
    const parsed = parseRawFile(await readFile(abs, "utf-8"));
    if (!parsed) throw new Error(`raw file ilegível: ${relPath}`);
    parsed.frontmatter.triage = triage;
    parsed.frontmatter.tenant = triage.tenant;
    parsed.frontmatter.contains_pii = triage.contains_pii;
    await writeFileAtomic(abs, serializeRawFile(parsed.frontmatter, parsed.body));
  });
}

export async function markCompiledInto(relPath: string, paths: string[]): Promise<void> {
  await brainWriteLock(async () => {
    const abs = resolve(brainRoot, relPath);
    const parsed = parseRawFile(await readFile(abs, "utf-8"));
    if (!parsed) throw new Error(`raw file ilegível: ${relPath}`);
    const merged = new Set([...(parsed.frontmatter.compiled_into ?? []), ...paths]);
    parsed.frontmatter.compiled_into = [...merged].sort();
    await writeFileAtomic(abs, serializeRawFile(parsed.frontmatter, parsed.body));
  });
}

export async function readThread(relPath: string): Promise<{ frontmatter: RawFrontmatter; blocks: RawMessageBlock[] } | null> {
  try {
    const parsed = parseRawFile(await readFile(resolve(brainRoot, relPath), "utf-8"));
    if (!parsed) return null;
    return { frontmatter: parsed.frontmatter, blocks: parseBlocks(parsed.body) };
  } catch {
    return null;
  }
}

export async function findThreadPath(threadKey: string, channel: string): Promise<string | null> {
  return findExistingPath(threadKey, channel);
}
