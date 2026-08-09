import { google, type calendar_v3 } from "googleapis";
import { emitCanonicalEvent } from "../canonical.js";
import { getRedis, KEYS, incrMetric } from "../redis.js";
import {
  getAuthorizedClient,
  isInvalidGrant,
  listConnectedEmails,
  markReauthRequired,
} from "./google-auth.js";
import type { CanonicalEvent, CanonicalParticipant } from "../types.js";

const FULL_SYNC_PAST_DAYS = 30;
const FULL_SYNC_FUTURE_DAYS = 180;

export interface CalendarPollSummary {
  account: string;
  fetched: number;
  emitted: number;
  error: string;
}

function participantsOf(event: calendar_v3.Schema$Event): CanonicalParticipant[] {
  const list: CanonicalParticipant[] = [];
  if (event.organizer?.email) {
    list.push({
      name: event.organizer.displayName ?? event.organizer.email,
      handle: event.organizer.email,
      role: "organizer",
    });
  }
  for (const attendee of event.attendees ?? []) {
    if (!attendee.email || attendee.email === event.organizer?.email) continue;
    list.push({
      name: attendee.displayName ?? attendee.email,
      handle: attendee.email,
      role: "attendee",
    });
  }
  return list;
}

function describeEvent(event: calendar_v3.Schema$Event): string {
  const lines: string[] = [];
  const start = event.start?.dateTime ?? event.start?.date ?? "";
  const end = event.end?.dateTime ?? event.end?.date ?? "";
  if (event.status === "cancelled") lines.push("**Evento cancelado.**");
  if (start) lines.push(`Início: ${start}`);
  if (end) lines.push(`Fim: ${end}`);
  if (event.location) lines.push(`Local: ${event.location}`);
  if (event.recurrence?.length) lines.push(`Recorrência: ${event.recurrence.join("; ")}`);
  if (event.attendees?.length) {
    const names = event.attendees.map((a) => a.displayName ?? a.email ?? "").filter(Boolean);
    lines.push(`Participantes: ${names.join(", ")}`);
  }
  if (event.hangoutLink) lines.push(`Meet: ${event.hangoutLink}`);
  if (event.description) lines.push("", event.description);
  return lines.join("\n");
}

async function processEvent(account: string, event: calendar_v3.Schema$Event): Promise<"emitted" | "duplicate"> {
  const id = event.id ?? "";
  if (!id) return "duplicate";
  const revision = event.updated ?? event.created ?? "";
  const canonical: CanonicalEvent = {
    channel: "calendar",
    subchannel: (event.attendees?.length ?? 0) > 1 ? "group" : "direct",
    account,
    external_id: `gcal:${account}:${id}@${revision}`,
    thread_key: `gcal:${account}:${event.recurringEventId ?? id}`,
    occurred_at: event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00Z` : revision || new Date().toISOString()),
    participants: participantsOf(event),
    subject: event.summary ?? "(sem título)",
    body_text: describeEvent(event),
    attachments: [],
  };
  const result = await emitCanonicalEvent(canonical);
  if (result === "emitted") await incrMetric("events:calendar");
  return result;
}

async function pollAccount(account: string): Promise<CalendarPollSummary> {
  const summary: CalendarPollSummary = { account, fetched: 0, emitted: 0, error: "" };
  const auth = getAuthorizedClient(account);
  if (!auth) {
    summary.error = "sem credencial válida";
    return summary;
  }
  const calendar = google.calendar({ version: "v3", auth });
  const redis = getRedis();
  const cursorKey = KEYS.cursorCalendar(account);

  const listPage = (
    params: calendar_v3.Params$Resource$Events$List,
  ): Promise<{ data: calendar_v3.Schema$Events }> => calendar.events.list(params);

  try {
    let syncToken = await redis.get(cursorKey);
    let pageToken: string | undefined;
    let newSyncToken = "";
    const items: calendar_v3.Schema$Event[] = [];

    const baseParams: calendar_v3.Params$Resource$Events$List = {
      calendarId: "primary",
      maxResults: 250,
      singleEvents: false,
      showDeleted: true,
    };

    const runFullSync = async (): Promise<void> => {
      const timeMin = new Date(Date.now() - FULL_SYNC_PAST_DAYS * 86_400_000).toISOString();
      const timeMax = new Date(Date.now() + FULL_SYNC_FUTURE_DAYS * 86_400_000).toISOString();
      pageToken = undefined;
      do {
        const res = await listPage({ ...baseParams, timeMin, timeMax, pageToken });
        items.push(...(res.data.items ?? []));
        pageToken = res.data.nextPageToken ?? undefined;
        if (res.data.nextSyncToken) newSyncToken = res.data.nextSyncToken;
      } while (pageToken);
    };

    if (!syncToken) {
      await runFullSync();
    } else {
      try {
        do {
          const res = await listPage({ ...baseParams, syncToken, pageToken });
          items.push(...(res.data.items ?? []));
          pageToken = res.data.nextPageToken ?? undefined;
          if (res.data.nextSyncToken) newSyncToken = res.data.nextSyncToken;
        } while (pageToken);
      } catch (err) {
        const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
        if (status === 410) {
          await redis.del(cursorKey);
          syncToken = null;
          await runFullSync();
        } else {
          throw err;
        }
      }
    }

    for (const event of items) {
      const result = await processEvent(account, event);
      summary.fetched += 1;
      if (result === "emitted") summary.emitted += 1;
    }
    if (newSyncToken) await redis.set(cursorKey, newSyncToken);
  } catch (err) {
    if (isInvalidGrant(err)) {
      markReauthRequired(account);
      summary.error = "reauth_required";
    } else {
      summary.error = err instanceof Error ? err.message : String(err);
    }
  }
  return summary;
}

export async function pollCalendar(): Promise<CalendarPollSummary[]> {
  const summaries: CalendarPollSummary[] = [];
  for (const account of listConnectedEmails()) {
    summaries.push(await pollAccount(account));
  }
  return summaries;
}

export async function backfillCalendarRange(
  account: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarPollSummary> {
  const summary: CalendarPollSummary = { account, fetched: 0, emitted: 0, error: "" };
  const auth = getAuthorizedClient(account);
  if (!auth) {
    summary.error = "sem credencial válida";
    return summary;
  }
  const calendar = google.calendar({ version: "v3", auth });
  try {
    let pageToken: string | undefined;
    do {
      const res = await calendar.events.list({
        calendarId: "primary",
        maxResults: 250,
        singleEvents: false,
        showDeleted: false,
        timeMin,
        timeMax,
        pageToken,
      });
      for (const event of res.data.items ?? []) {
        const result = await processEvent(account, event);
        summary.fetched += 1;
        if (result === "emitted") summary.emitted += 1;
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    if (isInvalidGrant(err)) {
      markReauthRequired(account);
      summary.error = "reauth_required";
    } else {
      summary.error = err instanceof Error ? err.message : String(err);
    }
  }
  return summary;
}
