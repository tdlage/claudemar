import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { emitCanonicalEvent } from "../canonical.js";
import { incrMetric } from "../redis.js";
import { transcribeAudio } from "../../transcription.js";
import { dayKeyInTz, hash8 } from "../text.js";
import { brainSchedulers } from "../schedulers.js";
import type { CanonicalEvent } from "../types.js";

const execFileAsync = promisify(execFile);

const COMPOSE_SERVICE = "whatsapp-bridge";
const COMPOSE_TIMEOUT_MS = 120_000;
const WINDOW_CUT_HOURS = 4;

function authHeaders(): Record<string, string> {
  if (!config.whatsappBridgeAuth) return {};
  return { Authorization: `Basic ${Buffer.from(config.whatsappBridgeAuth).toString("base64")}` };
}

async function rawFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${config.whatsappBridgeUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`bridge ${path} respondeu HTTP ${res.status}`);
  return res.json();
}

interface BridgeDevice {
  id: string;
  state?: string;
}

function deviceList(raw: unknown): BridgeDevice[] {
  const results = (raw as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id : typeof e.device === "string" ? e.device : "";
      return { id, state: typeof e.state === "string" ? e.state : undefined };
    })
    .filter((d) => d.id);
}

let deviceId: string | null = null;

/**
 * O bridge é multi-dispositivo: toda rota /app/* exige X-Device-Id e recusa a chamada sem ele.
 * Reaproveita um device já pareado quando existe; só cria um novo se o bridge estiver vazio.
 */
async function ensureDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  const devices = deviceList(await rawFetch("/devices"));
  const connected = devices.find((d) => d.state === "connected");
  const chosen = connected ?? devices[0];
  if (chosen) {
    deviceId = chosen.id;
    return deviceId;
  }
  const created = await rawFetch("/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "claudemar" }),
  });
  const id = (created as { results?: { id?: string } } | undefined)?.results?.id;
  if (!id) throw new Error("bridge não devolveu id do device criado");
  deviceId = id;
  return deviceId;
}

export function resetWhatsappDevice(): void {
  deviceId = null;
}

async function bridgeFetch(path: string): Promise<unknown> {
  const device = await ensureDeviceId();
  try {
    return await rawFetch(path, { headers: { "X-Device-Id": device } });
  } catch (err) {
    if (err instanceof Error && /HTTP 404/.test(err.message)) {
      resetWhatsappDevice();
      return rawFetch(path, { headers: { "X-Device-Id": await ensureDeviceId() } });
    }
    throw err;
  }
}

export function whatsappWindowDay(timestampMs: number): string {
  return dayKeyInTz(new Date(timestampMs - WINDOW_CUT_HOURS * 3_600_000), config.brainTz);
}

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = config.brainWhatsappWebhookSecret;
  if (!secret) return false;
  if (!signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

interface WebhookRecord {
  [key: string]: unknown;
}

function pick(record: WebhookRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function pickNested(record: WebhookRecord, path: string[]): string {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as WebhookRecord)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function hasNested(record: WebhookRecord, path: string[]): boolean {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") return false;
    current = (current as WebhookRecord)[key];
  }
  return current !== undefined && current !== null;
}

function parseTimestamp(raw: string): number {
  if (!raw) return Date.now();
  if (/^\d{10}$/.test(raw)) return Number(raw) * 1000;
  if (/^\d{13}$/.test(raw)) return Number(raw);
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function jidUser(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

export interface MappedWebhook {
  event: CanonicalEvent;
  /** Só quando a mensagem é áudio sem legenda: id para baixar e transcrever sob demanda. */
  voiceNoteId: string | null;
}

export function mapWebhookToEvent(body: unknown): MappedWebhook | null {
  if (!body || typeof body !== "object") return null;
  const root = body as WebhookRecord;
  const eventType = pick(root, ["event", "type"]);
  if (eventType && !/^message(s)?(\.(any|text|upsert))?$/.test(eventType)) return null;

  const payload = (root.payload && typeof root.payload === "object" ? root.payload : root) as WebhookRecord;
  const account = pick(root, ["device_id", "device"]) || "whatsapp";

  const chatJid = pick(payload, ["chat_id", "chat", "from", "remote_jid"]) || pickNested(payload, ["key", "remoteJid"]);
  const senderJid =
    pick(payload, ["sender_id", "sender", "participant", "author"]) ||
    pickNested(payload, ["key", "participant"]) ||
    chatJid;
  const text =
    pick(payload, ["message", "text", "body", "caption"]) ||
    pickNested(payload, ["message", "text"]) ||
    pickNested(payload, ["message", "conversation"]);
  const messageId = pick(payload, ["message_id", "id"]) || pickNested(payload, ["key", "id"]);
  if (!chatJid || (!text && !messageId)) return null;

  const timestampMs = parseTimestamp(pick(payload, ["timestamp", "time", "message_timestamp"]));
  const isGroup = chatJid.includes("@g.us");
  const chatId = jidUser(chatJid);
  const pushName = pick(payload, ["pushname", "push_name", "sender_name", "name"]);
  const chatName = pick(payload, ["chat_name", "group_name", "subject"]);

  const mimetype = (
    pick(payload, ["mimetype", "mime_type"]) || pickNested(payload, ["message", "mimetype"])
  ).toLowerCase();
  const kind = (pick(payload, ["type", "media_type", "message_type"]) || "").toLowerCase();
  const isAudio =
    mimetype.startsWith("audio/") ||
    kind === "audio" ||
    kind === "ptt" ||
    kind === "voice" ||
    hasNested(payload, ["message", "audioMessage"]);

  const event: CanonicalEvent = {
    channel: "whatsapp",
    subchannel: isGroup ? "group" : "direct",
    account,
    external_id: `wa:${account}:${messageId || hash8(`${chatJid}:${timestampMs}:${text}`)}`,
    thread_key: `wa:${account}:${chatId}:${whatsappWindowDay(timestampMs)}`,
    occurred_at: new Date(timestampMs).toISOString(),
    participants: [{ name: pushName || jidUser(senderJid), handle: senderJid, role: "from" }],
    subject: chatName || (isGroup ? `grupo ${chatId}` : `conversa com ${pushName || chatId}`),
    body_text: text || (isAudio ? AUDIO_PLACEHOLDER : "[mensagem sem texto — mídia não persistida]"),
    attachments: [],
  };
  return { event, voiceNoteId: isAudio && !text && messageId ? messageId : null };
}

const AUDIO_PLACEHOLDER = "[áudio sem transcrição]";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Baixa o áudio sob demanda só para transcrever e descarta os bytes: o bridge roda com
 * WHATSAPP_AUTO_DOWNLOAD_MEDIA=false justamente para não guardar mídia em disco.
 */
async function transcribeVoiceNote(messageId: string): Promise<string | null> {
  if (!config.openaiApiKey) return null;
  try {
    const device = await ensureDeviceId();
    const res = await fetch(`${config.whatsappBridgeUrl}/message/${encodeURIComponent(messageId)}/download`, {
      headers: { ...authHeaders(), "X-Device-Id": device },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`download respondeu HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error("download vazio");
    if (buffer.length > MAX_AUDIO_BYTES) throw new Error(`áudio acima de ${MAX_AUDIO_BYTES} bytes`);
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("mpeg") ? "mp3" : type.includes("mp4") || type.includes("m4a") ? "m4a" : "ogg";
    const text = (await transcribeAudio(buffer, `nota-de-voz.${ext}`)).trim();
    if (!text) return null;
    await incrMetric("whatsapp:transcribed");
    return text;
  } catch (err) {
    await incrMetric("whatsapp:transcription_failed");
    console.error(
      "[brain:whatsapp] falha ao transcrever nota de voz:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export async function handleWebhook(body: unknown): Promise<"emitted" | "duplicate" | "ignored"> {
  const mapped = mapWebhookToEvent(body);
  if (!mapped) return "ignored";
  const { event, voiceNoteId } = mapped;
  if (voiceNoteId) {
    const transcript = await transcribeVoiceNote(voiceNoteId);
    event.body_text = transcript
      ? `[nota de voz transcrita]\n${transcript}`
      : "[áudio — transcrição indisponível]";
  }
  const result = await emitCanonicalEvent(event);
  if (result === "emitted") await incrMetric("events:whatsapp");
  return result;
}

export interface WhatsappBridgeStatus {
  reachable: boolean;
  connected: boolean;
  loggedIn: boolean;
  detail: string;
}

function deepFindBoolean(value: unknown, keys: string[]): boolean | null {
  if (!value || typeof value !== "object") return null;
  const record = value as WebhookRecord;
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  for (const nested of Object.values(record)) {
    const found = deepFindBoolean(nested, keys);
    if (found !== null) return found;
  }
  return null;
}

export async function whatsappStatus(): Promise<WhatsappBridgeStatus> {
  try {
    const raw = await bridgeFetch("/app/status");
    const connected = deepFindBoolean(raw, ["is_connected", "connected"]) ?? false;
    const loggedIn = deepFindBoolean(raw, ["is_logged_in", "logged_in", "loggedIn"]) ?? connected;
    return {
      reachable: true,
      connected,
      loggedIn,
      detail: JSON.stringify(raw).slice(0, 500),
    };
  } catch (err) {
    return {
      reachable: false,
      connected: false,
      loggedIn: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function deepFindString(value: unknown, predicate: (s: string) => boolean): string | null {
  if (typeof value === "string") return predicate(value) ? value : null;
  if (!value || typeof value !== "object") return null;
  for (const nested of Object.values(value as WebhookRecord)) {
    const found = deepFindString(nested, predicate);
    if (found) return found;
  }
  return null;
}

export async function whatsappQr(): Promise<{ dataUri: string } | { error: string }> {
  try {
    const raw = await bridgeFetch("/app/login");
    const link = deepFindString(raw, (s) => /qr/i.test(s) && /(https?:\/\/|\/statics\/|\.png)/i.test(s));
    if (!link) {
      const inline = deepFindString(raw, (s) => s.startsWith("data:image/"));
      if (inline) return { dataUri: inline };
      return { error: `resposta do bridge sem QR reconhecível: ${JSON.stringify(raw).slice(0, 300)}` };
    }
    const url = /^https?:\/\//.test(link)
      ? link.replace(/^https?:\/\/[^/]+/, config.whatsappBridgeUrl)
      : `${config.whatsappBridgeUrl}${link.startsWith("/") ? "" : "/"}${link}`;
    const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { error: `falha ao baixar QR (HTTP ${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") ?? "image/png";
    return { dataUri: `data:${mime};base64,${buf.toString("base64")}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function startWhatsappBridge(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync("docker", ["compose", "up", "-d", COMPOSE_SERVICE], {
      cwd: config.installDir,
      timeout: COMPOSE_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[brain:whatsapp] falha ao subir o bridge:", detail);
    return { ok: false, error: detail };
  }
}

async function ensureBridgeUp(): Promise<void> {
  await startWhatsappBridge();
}

brainSchedulers.register({
  name: "whatsapp",
  cadenceMs: (s) => s.cadences.whatsappMs,
  disabledReason: () =>
    config.brainWhatsappWebhookSecret ? null : "BRAIN_WHATSAPP_WEBHOOK_SECRET ausente (webhook ficaria aberto)",
  run: async () => {
    let status = await whatsappStatus();
    if (!status.reachable) {
      await ensureBridgeUp();
      status = await whatsappStatus();
    }
    if (!status.reachable) return `erro:bridge inacessível — ${status.detail}`;
    if (!status.loggedIn) return "erro:sessão desconectada — escaneie o QR em Configurações";
    return "sessão ativa";
  },
});
