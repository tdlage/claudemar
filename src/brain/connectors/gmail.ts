import { google, type gmail_v1 } from "googleapis";
import { emitCanonicalEvent } from "../canonical.js";
import { storeAttachment, storeOriginal } from "../attachments.js";
import { brainKeys, getRedis, incrMetric } from "../redis.js";
import { sha256Hex } from "../text.js";
import { MAX_EVENT_CHARS } from "../normalize.js";
import { brainSettings } from "../settings.js";
import type { BrainScope } from "../scope.js";
import { buildCategoryQuery, detectBulk, matchesBlockedSender, skippedByLabels } from "../email-filter.js";
import {
  getAuthorizedClient,
  isInvalidGrant,
  listConnectedEmails,
  markReauthRequired,
} from "./google-auth.js";
import type { BrainSettings, CanonicalEvent, CanonicalParticipant, StoredAttachment } from "../types.js";

const FETCH_PACE_MS = 60;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const BOOTSTRAP_QUERY = "newer_than:7d";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseAddressList(value: string | undefined, role: string): CanonicalParticipant[] {
  if (!value) return [];
  return value
    .split(/,(?![^<]*>)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(part);
      if (match) return { name: match[1].trim() || match[2].trim(), handle: match[2].trim(), role };
      return { name: part, handle: part.includes("@") ? part : "", role };
    });
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

interface MimeContent {
  text: string;
  html: string;
  attachmentParts: { filename: string; attachmentId: string; size: number }[];
}

function walkParts(payload: gmail_v1.Schema$MessagePart | undefined, acc: MimeContent): void {
  if (!payload) return;
  const mime = payload.mimeType ?? "";
  if (payload.filename && payload.body?.attachmentId) {
    acc.attachmentParts.push({
      filename: payload.filename,
      attachmentId: payload.body.attachmentId,
      size: payload.body.size ?? 0,
    });
  } else if (mime === "text/plain" && payload.body?.data) {
    acc.text += (acc.text ? "\n" : "") + decodeBody(payload.body.data);
  } else if (mime === "text/html" && payload.body?.data) {
    acc.html += decodeBody(payload.body.data);
  }
  for (const part of payload.parts ?? []) walkParts(part, acc);
}

async function alreadySeen(scope: BrainScope, externalId: string): Promise<boolean> {
  try {
    const hash = sha256Hex(`email:${externalId}`);
    return (await getRedis().exists(brainKeys(scope).seen(hash))) === 1;
  } catch {
    return false;
  }
}

async function markSkipped(scope: BrainScope, externalId: string): Promise<void> {
  try {
    const hash = sha256Hex(`email:${externalId}`);
    await getRedis().set(brainKeys(scope).seen(hash), "1", "EX", 400 * 24 * 60 * 60, "NX");
  } catch {}
}

function filterQuery(settings: BrainSettings): string {
  return [settings.gmailQuery, buildCategoryQuery(settings.emailFilter.skipCategories)]
    .filter(Boolean)
    .join(" ");
}

export interface GmailPollSummary {
  account: string;
  fetched: number;
  emitted: number;
  error: string;
}

/**
 * 404 do Gmail: a mensagem sumiu entre o history.list e o fetch (apagada de vez, ou o
 * histórico referencia algo que não existe mais). Reter o cursor por isso trava a conta
 * para sempre, porque a próxima tentativa vai bater no mesmo 404.
 */
function isMessageGone(err: unknown): boolean {
  const status = (err as { status?: number; code?: number } | undefined)?.status ??
    (err as { code?: number } | undefined)?.code;
  if (status === 404) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /requested entity was not found|not found/i.test(message);
}

async function processMessage(
  scope: BrainScope,
  gmail: gmail_v1.Gmail,
  account: string,
  messageId: string,
): Promise<"emitted" | "duplicate" | "skipped" | "filtered"> {
  const externalId = `gmail:${account}:${messageId}`;
  if (await alreadySeen(scope, externalId)) return "skipped";

  const settings = brainSettings(scope).get();
  const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  const msg = res.data;
  const headers = msg.payload?.headers;

  const skipReason = skippedByLabels(msg.labelIds ?? undefined, settings.emailFilter.skipCategories);
  if (skipReason) {
    await markSkipped(scope, externalId);
    await incrMetric(scope, `email_filtered:${skipReason}`);
    return "filtered";
  }

  const fromParticipant = parseAddressList(header(headers, "From"), "from")[0];
  if (fromParticipant?.handle && matchesBlockedSender(fromParticipant.handle, settings.emailFilter.blockedSenders)) {
    await markSkipped(scope, externalId);
    await incrMetric(scope, "email_filtered:blocked_sender");
    return "filtered";
  }

  const bulkReason = detectBulk({
    listUnsubscribe: header(headers, "List-Unsubscribe") || undefined,
    listId: header(headers, "List-Id") || undefined,
    precedence: header(headers, "Precedence") || undefined,
    autoSubmitted: header(headers, "Auto-Submitted") || undefined,
    fromHandle: fromParticipant?.handle,
  });

  const content: MimeContent = { text: "", html: "", attachmentParts: [] };
  walkParts(msg.payload, content);

  const attachments: StoredAttachment[] = [];
  for (const part of content.attachmentParts) {
    if (part.size > MAX_ATTACHMENT_BYTES) continue;
    try {
      const att = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.attachmentId,
      });
      if (att.data.data) {
        attachments.push(await storeAttachment(scope, Buffer.from(att.data.data, "base64url"), part.filename));
      }
      await sleep(FETCH_PACE_MS);
    } catch (err) {
      console.error(`[brain:gmail] anexo falhou (${part.filename}):`, err instanceof Error ? err.message : err);
    }
  }

  const occurredAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date().toISOString();
  const threadKey = `gmail:${account}:${msg.threadId ?? messageId}`;

  let bodyText = content.text;
  let rawRef: string | undefined;
  if (bodyText.length > MAX_EVENT_CHARS) {
    rawRef = await storeOriginal(scope, bodyText, threadKey, "txt");
    bodyText = bodyText.slice(0, MAX_EVENT_CHARS);
  }
  let bodyHtml = content.html || undefined;
  if (bodyHtml && bodyHtml.length > MAX_EVENT_CHARS * 4) {
    if (!rawRef) rawRef = await storeOriginal(scope, bodyHtml, threadKey, "html");
    bodyHtml = bodyHtml.slice(0, MAX_EVENT_CHARS * 4);
  }

  const event: CanonicalEvent = {
    channel: "email",
    subchannel: "direct",
    account,
    external_id: externalId,
    thread_key: threadKey,
    occurred_at: occurredAt,
    participants: [
      ...parseAddressList(header(headers, "From"), "from"),
      ...parseAddressList(header(headers, "To"), "to"),
      ...parseAddressList(header(headers, "Cc"), "cc"),
    ],
    subject: header(headers, "Subject"),
    body_text: bodyText,
    body_html: bodyHtml,
    attachments,
    raw_ref: rawRef,
    ...(bulkReason ? { bulk: true } : {}),
  };

  const result = await emitCanonicalEvent(scope, event);
  if (result === "emitted") {
    await incrMetric(scope, "events:email");
    if (msg.internalDate) {
      const key = brainKeys(scope).cursorGmailWatermark(account);
      const current = Number((await getRedis().get(key).catch(() => "0")) ?? 0);
      if (Number(msg.internalDate) > current) {
        await getRedis().set(key, msg.internalDate).catch(() => {});
      }
    }
  }
  return result;
}

async function listMessageIds(gmail: gmail_v1.Gmail, q: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken });
    for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

async function pollAccount(scope: BrainScope, account: string): Promise<GmailPollSummary> {
  const summary: GmailPollSummary = { account, fetched: 0, emitted: 0, error: "" };
  const auth = getAuthorizedClient(scope, account);
  if (!auth) {
    summary.error = "sem credencial válida";
    return summary;
  }
  const gmail = google.gmail({ version: "v1", auth });
  const redis = getRedis();
  const keys = brainKeys(scope);
  const settings = brainSettings(scope).get();
  const cursorKey = keys.cursorGmail(account);

  try {
    const cursor = await redis.get(cursorKey);
    let messageIds: string[] = [];
    let nextCursor = "";

    if (!cursor) {
      const profile = await gmail.users.getProfile({ userId: "me" });
      nextCursor = String(profile.data.historyId ?? "");
      const q = [BOOTSTRAP_QUERY, filterQuery(settings)].filter(Boolean).join(" ");
      messageIds = await listMessageIds(gmail, q);
    } else {
      try {
        let pageToken: string | undefined;
        do {
          const res = await gmail.users.history.list({
            userId: "me",
            startHistoryId: cursor,
            historyTypes: ["messageAdded"],
            maxResults: 100,
            pageToken,
          });
          for (const record of res.data.history ?? []) {
            for (const added of record.messagesAdded ?? []) {
              if (added.message?.id) messageIds.push(added.message.id);
            }
          }
          if (res.data.historyId) nextCursor = String(res.data.historyId);
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
        if (!nextCursor) nextCursor = cursor;
      } catch (err) {
        const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
        if (status === 404) {
          const watermark = Number((await redis.get(keys.cursorGmailWatermark(account))) ?? 0);
          const profile = await gmail.users.getProfile({ userId: "me" });
          nextCursor = String(profile.data.historyId ?? "");
          let window = BOOTSTRAP_QUERY;
          if (watermark > 0) {
            const since = new Date(watermark - 24 * 60 * 60 * 1000);
            const y = since.getUTCFullYear();
            const m = String(since.getUTCMonth() + 1).padStart(2, "0");
            const d = String(since.getUTCDate()).padStart(2, "0");
            window = `after:${y}/${m}/${d}`;
          }
          const q = [window, filterQuery(settings)].filter(Boolean).join(" ");
          messageIds = await listMessageIds(gmail, q);
        } else {
          throw err;
        }
      }
    }

    const unique = [...new Set(messageIds)];
    let retryable = 0;
    let gone = 0;
    for (const id of unique) {
      try {
        const result = await processMessage(scope, gmail, account, id);
        summary.fetched += 1;
        if (result === "emitted") summary.emitted += 1;
      } catch (err) {
        if (isInvalidGrant(err)) throw err;
        if (isMessageGone(err)) {
          gone += 1;
          continue;
        }
        retryable += 1;
        summary.error = err instanceof Error ? err.message : String(err);
        console.error(`[gmail] mensagem ${id} falhou (${account}):`, summary.error);
      }
      await sleep(FETCH_PACE_MS);
    }
    if (gone > 0) await incrMetric(scope, "gmail:gone", gone);
    if (retryable > 0) {
      summary.error = `${retryable} mensagem(ns) falharam — cursor mantido para nova tentativa: ${summary.error}`;
    } else if (nextCursor) {
      await redis.set(cursorKey, nextCursor);
    }
  } catch (err) {
    if (isInvalidGrant(err)) {
      markReauthRequired(scope, account);
      summary.error = "reauth_required";
    } else {
      summary.error = err instanceof Error ? err.message : String(err);
    }
  }
  return summary;
}

export async function pollGmail(scope: BrainScope): Promise<GmailPollSummary[]> {
  const summaries: GmailPollSummary[] = [];
  for (const account of listConnectedEmails(scope)) {
    summaries.push(await pollAccount(scope, account));
  }
  return summaries;
}

export async function backfillGmailRange(
  scope: BrainScope,
  account: string,
  afterDate: string,
  beforeDate: string,
  shouldStop: () => Promise<boolean>,
): Promise<GmailPollSummary> {
  const summary: GmailPollSummary = { account, fetched: 0, emitted: 0, error: "" };
  const auth = getAuthorizedClient(scope, account);
  if (!auth) {
    summary.error = "sem credencial válida";
    return summary;
  }
  const gmail = google.gmail({ version: "v1", auth });
  const settings = brainSettings(scope).get();
  try {
    const q = [`after:${afterDate}`, `before:${beforeDate}`, filterQuery(settings)].filter(Boolean).join(" ");
    const ids = await listMessageIds(gmail, q);
    for (const id of ids) {
      if (await shouldStop()) break;
      try {
        const result = await processMessage(scope, gmail, account, id);
        summary.fetched += 1;
        if (result === "emitted") summary.emitted += 1;
      } catch (err) {
        if (isInvalidGrant(err)) throw err;
        if (isMessageGone(err)) {
          await incrMetric(scope, "gmail:gone");
          continue;
        }
        summary.error = err instanceof Error ? err.message : String(err);
        console.error(`[gmail] backfill: mensagem ${id} falhou (${account}):`, summary.error);
      }
      await sleep(FETCH_PACE_MS);
    }
  } catch (err) {
    if (isInvalidGrant(err)) {
      markReauthRequired(scope, account);
      summary.error = "reauth_required";
    } else {
      summary.error = err instanceof Error ? err.message : String(err);
    }
  }
  return summary;
}
