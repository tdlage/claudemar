import { config } from "../config.js";
import { hash8, slugify } from "./text.js";
import { whatsappWindowDay } from "./connectors/whatsapp.js";
import type { CanonicalEvent } from "./types.js";

export interface ExportedMessage {
  at: number;
  sender: string;
  text: string;
  system: boolean;
}

const IOS_RE =
  /^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s?m?\.?\]\s?(.*)$/i;
const ANDROID_RE =
  /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m?\.?)?\s+[-–—]\s(.*)$/i;

function stripMarks(line: string): string {
  return line.replace(/[‎‏‪-‮﻿]/g, "");
}

function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

function wallTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  return guess - tzOffsetMs(tz, guess);
}

interface RawLine {
  first: number;
  second: number;
  year: number;
  hour: number;
  minute: number;
  second_: number;
  meridiem: string;
  rest: string;
}

function matchLine(line: string): RawLine | null {
  const ios = IOS_RE.exec(line);
  if (ios) {
    return {
      first: Number(ios[1]),
      second: Number(ios[2]),
      year: Number(ios[3].length === 2 ? `20${ios[3]}` : ios[3]),
      hour: Number(ios[4]),
      minute: Number(ios[5]),
      second_: ios[6] ? Number(ios[6]) : 0,
      meridiem: (ios[7] ?? "").toLowerCase(),
      rest: ios[8] ?? "",
    };
  }
  const android = ANDROID_RE.exec(line);
  if (android) {
    return {
      first: Number(android[1]),
      second: Number(android[2]),
      year: Number(android[3].length === 2 ? `20${android[3]}` : android[3]),
      hour: Number(android[4]),
      minute: Number(android[5]),
      second_: 0,
      meridiem: (android[6] ?? "").toLowerCase(),
      rest: android[7] ?? "",
    };
  }
  return null;
}

export function parseWhatsappExport(content: string, tz = config.brainTz): ExportedMessage[] {
  const lines = content.split(/\r?\n/).map(stripMarks);

  let dayFirst = true;
  let decided = false;
  for (const line of lines) {
    const raw = matchLine(line);
    if (!raw) continue;
    if (raw.first > 12) {
      dayFirst = true;
      decided = true;
      break;
    }
    if (raw.second > 12) {
      dayFirst = false;
      decided = true;
      break;
    }
  }
  if (!decided) dayFirst = true;

  const messages: ExportedMessage[] = [];
  for (const line of lines) {
    const raw = matchLine(line);
    if (!raw) {
      if (messages.length > 0 && line.trim()) {
        messages[messages.length - 1].text += `\n${line}`;
      }
      continue;
    }
    const day = dayFirst ? raw.first : raw.second;
    const month = dayFirst ? raw.second : raw.first;
    let hour = raw.hour;
    if (raw.meridiem === "p" && hour < 12) hour += 12;
    if (raw.meridiem === "a" && hour === 12) hour = 0;
    const at = wallTimeToUtc(raw.year, month, day, hour, raw.minute, raw.second_, tz);

    const senderMatch = /^([^:]+):\s([\s\S]*)$/.exec(raw.rest);
    if (senderMatch) {
      messages.push({ at, sender: senderMatch[1].trim(), text: senderMatch[2], system: false });
    } else {
      messages.push({ at, sender: "", text: raw.rest, system: true });
    }
  }
  return messages;
}

export function chatNameFromFilename(filename: string): string {
  return filename
    .replace(/\.(txt|zip)$/i, "")
    .replace(/^(Conversa do WhatsApp com|WhatsApp Chat with|Chat de WhatsApp con)\s*/i, "")
    .trim();
}

export function exportToEvents(params: {
  filename: string;
  content: string;
  account?: string;
}): CanonicalEvent[] {
  const account = (params.account ?? "whatsapp").trim() || "whatsapp";
  const chatName = chatNameFromFilename(params.filename) || "conversa-importada";
  const chatId = slugify(chatName, 40);
  const messages = parseWhatsappExport(params.content).filter((m) => !m.system && m.text.trim());
  const senders = new Set(messages.map((m) => m.sender));
  const isGroup = senders.size > 2;

  return messages.map((message, index) => ({
    channel: "whatsapp",
    subchannel: isGroup ? "group" : "direct",
    account,
    external_id: `waimport:${account}:${hash8(`${chatId}|${message.at}|${index}|${message.text.slice(0, 40)}`)}`,
    thread_key: `wa:${account}:${chatId}:${whatsappWindowDay(message.at)}`,
    occurred_at: new Date(message.at).toISOString(),
    participants: [{ name: message.sender, handle: `wa:${slugify(message.sender, 30)}`, role: "from" }],
    subject: isGroup ? `grupo ${chatName}` : `conversa com ${chatName}`,
    body_text: message.text,
    attachments: [],
  }));
}
