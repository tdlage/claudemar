import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { emitCanonicalEvent } from "../canonical.js";
import { incrMetric } from "../redis.js";
import { transcribeAudio } from "../../transcription.js";
import { dayKeyInTz, hash8 } from "../text.js";
import { brainSchedulers } from "../schedulers.js";
import { brainSettings } from "../settings.js";
import { emitStatusChanged } from "../events.js";
import { ADMIN_BRAIN, brainScope, isBrainOwnerId, perScope, userBrain, type BrainScope } from "../scope.js";
import type { BrainConnectionIssue, BrainWhatsappChat, CanonicalEvent } from "../types.js";

const execFileAsync = promisify(execFile);

const COMPOSE_SERVICE = "whatsapp-bridge";
const COMPOSE_TIMEOUT_MS = 120_000;
const WINDOW_CUT_HOURS = 4;
const DEVICE_PREFIX = "claudemar-";
const REGISTRY_PATH = resolve(config.dataPath, "brain-whatsapp-devices.json");
const REGISTRY_SYNC_INTERVAL_MS = 30_000;
const CHAT_PAGE_SIZE = 100;
const MAX_CHAT_RESULTS = 300;

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
  jid: string;
}

function deviceList(raw: unknown): BridgeDevice[] {
  const results = (raw as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id : typeof e.device === "string" ? e.device : "";
      return {
        id,
        state: typeof e.state === "string" ? e.state : undefined,
        jid: typeof e.jid === "string" ? e.jid : "",
      };
    })
    .filter((d) => d.id);
}

interface RegisteredDevice {
  id: string;
  owner: string;
  jid: string | null;
}

/**
 * Cada brain tem o próprio dispositivo no bridge (multi-dispositivo); este registro diz de quem é
 * cada um. O webhook é único para todos, então é por ele que uma mensagem chega ao brain certo.
 */
class WhatsappDeviceRegistry {
  private devices: RegisteredDevice[] = this.load();

  private load(): RegisteredDevice[] {
    if (!existsSync(REGISTRY_PATH)) return [];
    try {
      const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as { devices?: unknown };
      if (!Array.isArray(raw.devices)) return [];
      return raw.devices
        .map((entry) => (entry ?? {}) as Record<string, unknown>)
        .filter((e) => typeof e.id === "string" && e.id && isBrainOwnerId(e.owner))
        .map((e) => ({ id: e.id as string, owner: e.owner as string, jid: typeof e.jid === "string" && e.jid ? e.jid : null }));
    } catch (err) {
      console.error("[brain:whatsapp] registro de dispositivos ilegível:", err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  private save(next: RegisteredDevice[]): void {
    const tmp = `${REGISTRY_PATH}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ devices: next }, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, REGISTRY_PATH);
    this.devices = next;
  }

  ofOwner(owner: string): RegisteredDevice | null {
    return this.devices.find((d) => d.owner === owner) ?? null;
  }

  byId(id: string): RegisteredDevice | null {
    return this.devices.find((d) => d.id === id) ?? null;
  }

  byJid(jid: string): RegisteredDevice | null {
    const user = jidUser(jid);
    return this.devices.find((d) => d.jid !== null && jidUser(d.jid) === user) ?? null;
  }

  claimed(id: string): boolean {
    return this.devices.some((d) => d.id === id);
  }

  register(owner: string, id: string, jid: string | null): RegisteredDevice {
    const device = { id, owner, jid };
    this.save([...this.devices.filter((d) => d.owner !== owner && d.id !== id), device]);
    return device;
  }

  setJid(id: string, jid: string): void {
    const current = this.byId(id);
    if (!current || current.jid === jid) return;
    this.save(this.devices.map((d) => (d.id === id ? { ...d, jid } : d)));
  }

  remove(owner: string): RegisteredDevice | null {
    const current = this.ofOwner(owner);
    if (current) this.save(this.devices.filter((d) => d.owner !== owner));
    return current;
  }
}

const registry = new WhatsappDeviceRegistry();

function connectedFirst(devices: BridgeDevice[]): BridgeDevice[] {
  const rank = (d: BridgeDevice): number => (d.state === "logged_in" || d.state === "connected" ? 0 : 1);
  return [...devices].sort((a, b) => rank(a) - rank(b));
}

/**
 * Antes do brain por usuário o bridge tinha um único dispositivo, sempre do admin. Só ele pode ser
 * adotado — e só se não pertencer a ninguém nem tiver o prefixo dos dispositivos criados por brain.
 */
function legacyDevice(devices: BridgeDevice[]): BridgeDevice | null {
  return connectedFirst(devices).find((d) => !registry.claimed(d.id) && !d.id.startsWith(DEVICE_PREFIX)) ?? null;
}

async function createDevice(scope: BrainScope): Promise<string> {
  const created = await rawFetch("/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: `${DEVICE_PREFIX}${scope.owner}` }),
  });
  const id = (created as { results?: { id?: string; device_id?: string } } | undefined)?.results;
  const deviceId = id?.id ?? id?.device_id;
  if (!deviceId) throw new Error("bridge não devolveu id do dispositivo criado");
  if (registry.byId(deviceId) && registry.byId(deviceId)!.owner !== scope.owner) {
    throw new Error("o bridge devolveu um dispositivo que já pertence a outro brain");
  }
  return deviceId;
}

export function whatsappDeviceOf(scope: BrainScope): string | null {
  return registry.ofOwner(scope.owner)?.id ?? null;
}

async function ensureOwnerDevice(scope: BrainScope): Promise<string> {
  const existing = registry.ofOwner(scope.owner);
  if (existing) return existing.id;
  const devices = deviceList(await rawFetch("/devices"));
  const own = devices.find((d) => d.id === `${DEVICE_PREFIX}${scope.owner}` && !registry.claimed(d.id));
  if (own) return registry.register(scope.owner, own.id, own.jid || null).id;
  if (scope.isAdmin) {
    const legacy = legacyDevice(devices);
    if (legacy) return registry.register(scope.owner, legacy.id, legacy.jid || null).id;
  }
  return registry.register(scope.owner, await createDevice(scope), null).id;
}

async function deviceFetch(scope: BrainScope, path: string, init?: RequestInit): Promise<unknown> {
  const device = whatsappDeviceOf(scope);
  if (!device) throw new Error("WhatsApp ainda não pareado neste brain");
  const headers = { ...(init?.headers as Record<string, string> | undefined), "X-Device-Id": device };
  return rawFetch(path, { ...init, headers });
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
  /** Identificadores da conversa (JID e LID, sem domínio) para conferir contra a seleção do dono. */
  chatIds: string[];
}

export function mapWebhookToEvent(body: unknown): MappedWebhook | null {
  if (!body || typeof body !== "object") return null;
  const root = body as WebhookRecord;
  const eventType = pick(root, ["event", "type"]);
  if (eventType && !/^message(s)?(\.(any|text|upsert))?$/.test(eventType)) return null;

  const payload = (root.payload && typeof root.payload === "object" ? root.payload : root) as WebhookRecord;
  const account = pick(root, ["device_id", "device"]) || "whatsapp";

  const chatJid =
    pick(payload, ["chat_jid", "chat_id", "chat", "from", "remote_jid"]) ||
    pickNested(payload, ["key", "remoteJid"]);
  const senderJid =
    pick(payload, ["sender_jid", "sender_id", "sender", "participant", "author"]) ||
    pickNested(payload, ["sender", "jid"]) ||
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
  const chatLid = pick(payload, ["chat_lid"]);
  const pushName =
    pick(payload, ["sender_display_name", "push_name", "pushname", "sender_name", "verified_name", "contact_name"]) ||
    pickNested(payload, ["sender", "name"]);
  const chatName =
    pick(payload, ["chat_name", "group_name", "subject"]) ||
    pickNested(payload, ["chat_info", "name"]) ||
    pickNested(payload, ["chat", "name"]);

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
  const chatIds = [chatId, chatLid ? jidUser(chatLid) : ""].filter(Boolean);
  return { event, voiceNoteId: isAudio && !text && messageId ? messageId : null, chatIds };
}

/** No brain de um usuário só entram as conversas que ele escolheu sincronizar; sem seleção, nada entra. */
export function isChatSelected(chats: BrainWhatsappChat[], chatIds: string[]): boolean {
  if (chats.length === 0 || chatIds.length === 0) return false;
  const selected = new Set(chats.map((chat) => jidUser(chat.jid)));
  return chatIds.some((id) => selected.has(id));
}

/** O brain do admin recebe todas as conversas do número dele; o de um usuário, só as selecionadas. */
export function acceptsChat(scope: BrainScope, chatIds: string[]): boolean {
  return scope.isAdmin || isChatSelected(brainSettings(scope).get().whatsapp.chats, chatIds);
}

const AUDIO_PLACEHOLDER = "[áudio sem transcrição]";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Baixa o áudio sob demanda só para transcrever e descarta os bytes: o bridge roda com
 * WHATSAPP_AUTO_DOWNLOAD_MEDIA=false justamente para não guardar mídia em disco.
 */
async function transcribeVoiceNote(scope: BrainScope, messageId: string): Promise<string | null> {
  const device = whatsappDeviceOf(scope);
  if (!config.openaiApiKey || !device) return null;
  try {
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
    await incrMetric(scope, "whatsapp:transcribed");
    return text;
  } catch (err) {
    await incrMetric(scope, "whatsapp:transcription_failed");
    console.error(
      `[brain:${scope.owner}:whatsapp] falha ao transcrever nota de voz:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

let lastRegistrySync = 0;

/** Atualiza o JID de cada dispositivo registrado e adota o dispositivo legado para o admin, se ainda não houver um. */
export async function syncWhatsappRegistry(force = false): Promise<void> {
  if (!force && Date.now() - lastRegistrySync < REGISTRY_SYNC_INTERVAL_MS) return;
  lastRegistrySync = Date.now();
  const devices = deviceList(await rawFetch("/devices"));
  for (const device of devices) {
    if (device.jid && registry.claimed(device.id)) registry.setJid(device.id, device.jid);
  }
  if (!registry.ofOwner(ADMIN_BRAIN)) {
    const legacy = legacyDevice(devices);
    if (legacy) registry.register(ADMIN_BRAIN, legacy.id, legacy.jid || null);
  }
}

/**
 * O slot (session_id) é autoritativo: o mesmo número pode estar pareado em mais de um slot, então o JID só
 * decide quando o bridge não informa o slot (versões antigas, com um único dispositivo).
 */
function lookupOwner(root: WebhookRecord): string | null {
  const session = pick(root, ["session_id"]);
  if (session) return registry.byId(session)?.owner ?? null;
  const device = pick(root, ["device_id", "device"]);
  if (!device) return null;
  return (registry.byId(device) ?? (device.includes("@") ? registry.byJid(device) : null))?.owner ?? null;
}

/** O payload é assinado pelo bridge: o dispositivo de origem que ele informa decide o dono da mensagem. */
export async function whatsappWebhookOwner(body: unknown): Promise<BrainScope | null> {
  if (!body || typeof body !== "object") return null;
  const root = body as WebhookRecord;
  let owner = lookupOwner(root);
  if (!owner) {
    await syncWhatsappRegistry().catch(() => {});
    owner = lookupOwner(root);
  }
  if (!owner) return null;
  return owner === ADMIN_BRAIN ? brainScope(ADMIN_BRAIN) : userBrain(owner);
}

export async function handleWebhook(
  scope: BrainScope,
  body: unknown,
): Promise<"emitted" | "duplicate" | "ignored" | "not_selected"> {
  const mapped = mapWebhookToEvent(body);
  if (!mapped) return "ignored";
  if (!acceptsChat(scope, mapped.chatIds)) {
    await incrMetric(scope, "whatsapp:not_selected");
    return "not_selected";
  }
  const { event, voiceNoteId } = mapped;
  if (voiceNoteId) {
    const transcript = await transcribeVoiceNote(scope, voiceNoteId);
    event.body_text = transcript
      ? `[nota de voz transcrita]\n${transcript}`
      : "[áudio — transcrição indisponível]";
  }
  const result = await emitCanonicalEvent(scope, event);
  if (result === "emitted") await incrMetric(scope, "events:whatsapp");
  return result;
}

export interface WhatsappBridgeStatus {
  reachable: boolean;
  paired: boolean;
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

function deepFindString(value: unknown, predicate: (s: string) => boolean): string | null {
  if (typeof value === "string") return predicate(value) ? value : null;
  if (!value || typeof value !== "object") return null;
  for (const nested of Object.values(value as WebhookRecord)) {
    const found = deepFindString(nested, predicate);
    if (found) return found;
  }
  return null;
}

const lastStatus = perScope((): { value: WhatsappBridgeStatus | null } => ({ value: null }));

function remember(scope: BrainScope, status: WhatsappBridgeStatus): WhatsappBridgeStatus {
  const state = lastStatus(scope);
  const changed = state.value?.loggedIn !== status.loggedIn || state.value?.reachable !== status.reachable;
  state.value = status;
  if (changed) emitStatusChanged(scope);
  return status;
}

export async function whatsappStatus(scope: BrainScope): Promise<WhatsappBridgeStatus> {
  const device = whatsappDeviceOf(scope);
  if (!device) {
    try {
      await rawFetch("/devices");
      return { reachable: true, paired: false, connected: false, loggedIn: false, detail: "nenhum dispositivo deste brain no bridge" };
    } catch (err) {
      return {
        reachable: false,
        paired: false,
        connected: false,
        loggedIn: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
  try {
    const raw = await deviceFetch(scope, "/app/status");
    const connected = deepFindBoolean(raw, ["is_connected", "connected"]) ?? false;
    const loggedIn = deepFindBoolean(raw, ["is_logged_in", "logged_in", "loggedIn"]) ?? connected;
    const jid = deepFindString(raw, (s) => /@s\.whatsapp\.net$/.test(s));
    if (jid) registry.setJid(device, jid);
    return remember(scope, { reachable: true, paired: true, connected, loggedIn, detail: JSON.stringify(raw).slice(0, 500) });
  } catch (err) {
    return remember(scope, {
      reachable: false,
      paired: true,
      connected: false,
      loggedIn: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function whatsappQr(scope: BrainScope): Promise<{ dataUri: string } | { error: string }> {
  try {
    await ensureOwnerDevice(scope);
    const raw = await deviceFetch(scope, "/app/login");
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

/** Desconecta o número e remove o dispositivo do bridge; a seleção de conversas fica para um novo pareamento. */
export async function disconnectWhatsapp(scope: BrainScope): Promise<void> {
  const device = registry.ofOwner(scope.owner);
  if (!device) return;
  const headers = { "X-Device-Id": device.id };
  await rawFetch(`/devices/${encodeURIComponent(device.id)}/logout`, { method: "POST", headers }).catch(() => {});
  await rawFetch(`/devices/${encodeURIComponent(device.id)}`, { method: "DELETE", headers }).catch((err) => {
    console.error(`[brain:${scope.owner}:whatsapp] falha ao remover o dispositivo do bridge:`, err instanceof Error ? err.message : String(err));
  });
  registry.remove(scope.owner);
  lastStatus(scope).value = null;
  emitStatusChanged(scope);
}

export interface WhatsappChatOption extends BrainWhatsappChat {
  lastMessageAt: string | null;
}

function chatKind(jid: string): BrainWhatsappChat["kind"] {
  return jid.endsWith("@g.us") ? "group" : "contact";
}

function listOf(raw: unknown): Record<string, unknown>[] {
  const results = (raw as { results?: unknown } | undefined)?.results;
  const data = Array.isArray(results) ? results : (results as { data?: unknown } | undefined)?.data;
  return Array.isArray(data) ? data.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function str(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Conversas recentes, grupos e contatos do número pareado, para o dono escolher o que sincronizar. */
export async function listWhatsappChats(scope: BrainScope, search: string): Promise<WhatsappChatOption[]> {
  const needle = search.trim().toLowerCase();
  const byJid = new Map<string, WhatsappChatOption>();
  const add = (jid: string, name: string, lastMessageAt: string | null): void => {
    const normalized = jid.trim().toLowerCase();
    if (!normalized.includes("@") || normalized.endsWith("@broadcast") || normalized.endsWith("@newsletter")) return;
    if (needle && !`${name} ${normalized}`.toLowerCase().includes(needle)) return;
    const current = byJid.get(normalized);
    if (current) {
      if (!current.name || current.name === jidUser(normalized)) current.name = name || current.name;
      current.lastMessageAt = current.lastMessageAt ?? lastMessageAt;
      return;
    }
    byJid.set(normalized, { jid: normalized, name: name || jidUser(normalized), kind: chatKind(normalized), lastMessageAt });
  };

  const query = new URLSearchParams({ limit: String(CHAT_PAGE_SIZE), offset: "0" });
  if (needle) query.set("search", needle);
  for (const chat of listOf(await deviceFetch(scope, `/chats?${query.toString()}`))) {
    add(str(chat, "jid"), str(chat, "name"), str(chat, "last_message_time") || null);
  }
  for (const group of listOf(await deviceFetch(scope, "/user/my/groups").catch(() => null))) {
    add(str(group, "JID", "jid"), str(group, "Name", "name"), null);
  }
  for (const contact of listOf(await deviceFetch(scope, "/user/my/contacts").catch(() => null))) {
    add(str(contact, "jid", "JID"), str(contact, "name", "Name"), null);
  }
  return [...byJid.values()]
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.name.localeCompare(b.name, "pt"))
    .slice(0, MAX_CHAT_RESULTS);
}

let bridgeStarting: Promise<{ ok: boolean; error?: string }> | null = null;

export function startWhatsappBridge(): Promise<{ ok: boolean; error?: string }> {
  if (!bridgeStarting) {
    bridgeStarting = execFileAsync("docker", ["compose", "up", "-d", COMPOSE_SERVICE], {
      cwd: config.installDir,
      timeout: COMPOSE_TIMEOUT_MS,
    })
      .then(() => ({ ok: true }))
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[brain:whatsapp] falha ao subir o bridge:", detail);
        return { ok: false, error: detail };
      })
      .finally(() => {
        bridgeStarting = null;
      });
  }
  return bridgeStarting;
}

export function whatsappConnectionIssues(scope: BrainScope): BrainConnectionIssue[] {
  const device = registry.ofOwner(scope.owner);
  const status = lastStatus(scope).value;
  if (!device || !status || !brainSettings(scope).get().schedulers.whatsapp) return [];
  if (!status.reachable) return [{ connector: "whatsapp", account: device.jid ?? device.id, message: "o bridge do WhatsApp está fora do ar" }];
  if (!status.loggedIn) {
    return [{ connector: "whatsapp", account: device.jid ?? device.id, message: "sessão desconectada — escaneie o QR de novo" }];
  }
  return [];
}

brainSchedulers.register({
  name: "whatsapp",
  cadenceMs: (s) => s.cadences.whatsappMs,
  disabledReason: (scope) => {
    if (!config.brainWhatsappWebhookSecret) return "BRAIN_WHATSAPP_WEBHOOK_SECRET ausente (webhook ficaria aberto)";
    return whatsappDeviceOf(scope) ? null : "WhatsApp ainda não pareado neste brain";
  },
  run: async (scope) => {
    let status = await whatsappStatus(scope);
    if (!status.reachable) {
      await startWhatsappBridge();
      status = await whatsappStatus(scope);
    }
    if (!status.reachable) return `erro:bridge inacessível — ${status.detail}`;
    if (!status.loggedIn) return "erro:sessão desconectada — escaneie o QR em Configurações";
    return "sessão ativa";
  },
});
