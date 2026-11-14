import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { config } from "../../config.js";
import { emitCanonicalEvent } from "../canonical.js";
import { brainKeys, getRedis, incrMetric } from "../redis.js";
import { dayKeyInTz } from "../text.js";
import { brainSchedulers } from "../schedulers.js";
import { brainSettings } from "../settings.js";
import { emitStatusChanged } from "../events.js";
import { ADMIN_BRAIN, adminBrain, listBrainOwners, perScope, userBrain, type BrainScope } from "../scope.js";
import type { BrainConnectionIssue, CanonicalEvent } from "../types.js";

const USER_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
];
const HISTORY_PAGE_LIMIT = 200;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const CONVERSATION_LIST_TTL_MS = 30 * MINUTE_MS;
const THREAD_WATCH_MS = 30 * DAY_MS;
const CONTENT_SUBTYPES = new Set(["thread_broadcast", "file_share", "bot_message", "me_message"]);
const CONVERSATION_TYPES = "public_channel,private_channel,mpim,im";
const REFRESH_MARGIN_MS = 5 * 60_000;
const VERIFY_INTERVAL_MS = 15 * 60_000;
const REVOKED_ERRORS = new Set(["invalid_auth", "token_revoked", "account_inactive", "invalid_refresh_token", "not_authed", "token_expired"]);

interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string };
  text?: string;
  attachments?: { pretext?: string; title?: string; text?: string; fallback?: string }[];
  files?: { name?: string; title?: string }[];
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
  team?: string;
}

interface SlackConversation {
  id: string;
  name: string;
  type: "im" | "mpim" | "channel";
}

/** Ponto de sincronização de uma conversa ou thread: última mensagem lida, última verificação e última atividade. */
interface SyncPoint {
  ts: string | null;
  checkedAt: number;
  activityAt: number;
}

interface SlackAuthorization {
  team_id?: string;
  user_id?: string;
}

interface SlackEventBody {
  team_id?: string;
  event_context?: string;
  authorizations?: SlackAuthorization[];
}

interface SlackConnection {
  teamId: string;
  teamName: string;
  userId: string;
  userName: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  reauthRequired: boolean;
  connectedAt: string;
  lastVerifiedAt: number | null;
}

export interface SlackConnectionInfo {
  teamId: string;
  teamName: string;
  userId: string;
  userName: string;
  reauthRequired: boolean;
  connectedAt: string;
}

export function slackConfigured(): boolean {
  return Boolean(config.slackClientId && config.slackClientSecret && config.slackAppToken);
}

export function slackRedirectUri(): string {
  const base = config.publicBaseUrl || `http://localhost:${config.dashboardPort}`;
  return `${base.replace(/\/$/, "")}/api/brain/slack/callback`;
}

export function buildSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.slackClientId,
    user_scope: USER_SCOPES.join(","),
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

function errorCode(err: unknown): string {
  const data = (err as { data?: { error?: string } } | undefined)?.data;
  if (data?.error) return data.error;
  return err instanceof Error ? err.message : String(err);
}

const connectionStore = perScope((): { connections: SlackConnection[] | null } => ({ connections: null }));

function loadConnections(scope: BrainScope): SlackConnection[] {
  const store = connectionStore(scope);
  if (store.connections) return store.connections;
  let connections: SlackConnection[] = [];
  if (existsSync(scope.slackTokensFile)) {
    try {
      const raw = JSON.parse(readFileSync(scope.slackTokensFile, "utf-8")) as unknown;
      if (Array.isArray(raw)) {
        connections = raw.filter((entry): entry is SlackConnection => {
          const e = entry as Partial<SlackConnection> | null;
          return Boolean(e && typeof e.teamId === "string" && typeof e.userId === "string" && typeof e.accessToken === "string");
        });
      }
    } catch (err) {
      console.error(`[brain:${scope.owner}:slack] tokens ilegíveis:`, err instanceof Error ? err.message : String(err));
    }
  }
  store.connections = connections;
  return connections;
}

function saveConnections(scope: BrainScope, connections: SlackConnection[]): void {
  mkdirSync(dirname(scope.slackTokensFile), { recursive: true, mode: 0o700 });
  const tmp = `${scope.slackTokensFile}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(connections, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, scope.slackTokensFile);
  connectionStore(scope).connections = connections;
}

function updateConnection(scope: BrainScope, teamId: string, userId: string, patch: Partial<SlackConnection>): void {
  saveConnections(
    scope,
    loadConnections(scope).map((c) => (c.teamId === teamId && c.userId === userId ? { ...c, ...patch } : c)),
  );
}

function info(connection: SlackConnection): SlackConnectionInfo {
  return {
    teamId: connection.teamId,
    teamName: connection.teamName,
    userId: connection.userId,
    userName: connection.userName,
    reauthRequired: connection.reauthRequired,
    connectedAt: connection.connectedAt,
  };
}

export function listSlackConnections(scope: BrainScope): SlackConnectionInfo[] {
  return loadConnections(scope).map(info);
}

interface TokenGrant {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id?: string;
}

function grantOf(response: Record<string, unknown>): TokenGrant {
  const user = (response.authed_user ?? {}) as TokenGrant;
  return {
    access_token: user.access_token ?? (response.access_token as string | undefined),
    refresh_token: user.refresh_token ?? (response.refresh_token as string | undefined),
    expires_in: user.expires_in ?? (response.expires_in as number | undefined),
    id: user.id,
  };
}

export async function handleSlackCallback(scope: BrainScope, code: string): Promise<SlackConnectionInfo> {
  const response = (await new WebClient().oauth.v2.access({
    client_id: config.slackClientId,
    client_secret: config.slackClientSecret,
    code,
    redirect_uri: slackRedirectUri(),
  })) as unknown as Record<string, unknown>;
  const grant = grantOf(response);
  const team = (response.team ?? {}) as { id?: string; name?: string };
  if (!grant.access_token || !grant.id || !team.id) throw new Error("o Slack não devolveu um token de usuário");
  const web = new WebClient(grant.access_token);
  const profile = await web.users.info({ user: grant.id }).catch(() => null);
  const userName = profile?.user?.profile?.display_name || profile?.user?.real_name || profile?.user?.name || grant.id;
  const connection: SlackConnection = {
    teamId: team.id,
    teamName: team.name ?? team.id,
    userId: grant.id,
    userName,
    accessToken: grant.access_token,
    refreshToken: grant.refresh_token ?? null,
    expiresAt: grant.expires_in ? Date.now() + grant.expires_in * 1000 : null,
    reauthRequired: false,
    connectedAt: new Date().toISOString(),
    lastVerifiedAt: Date.now(),
  };
  saveConnections(scope, [
    ...loadConnections(scope).filter((c) => !(c.teamId === connection.teamId && c.userId === connection.userId)),
    connection,
  ]);
  emitStatusChanged(scope);
  void slackSocket.ensureStarted().catch(() => {});
  return info(connection);
}

async function freshToken(scope: BrainScope, connection: SlackConnection): Promise<string> {
  if (!connection.refreshToken || !connection.expiresAt || connection.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return connection.accessToken;
  }
  try {
    const response = (await new WebClient().oauth.v2.access({
      client_id: config.slackClientId,
      client_secret: config.slackClientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    })) as unknown as Record<string, unknown>;
    const grant = grantOf(response);
    if (!grant.access_token) throw new Error("renovação sem token");
    updateConnection(scope, connection.teamId, connection.userId, {
      accessToken: grant.access_token,
      refreshToken: grant.refresh_token ?? connection.refreshToken,
      expiresAt: grant.expires_in ? Date.now() + grant.expires_in * 1000 : null,
      reauthRequired: false,
    });
    return grant.access_token;
  } catch (err) {
    if (REVOKED_ERRORS.has(errorCode(err))) markReauthRequired(scope, connection);
    throw err;
  }
}

function markReauthRequired(scope: BrainScope, connection: SlackConnection): void {
  if (connection.reauthRequired) return;
  updateConnection(scope, connection.teamId, connection.userId, { reauthRequired: true });
  emitStatusChanged(scope);
}

export async function disconnectSlack(scope: BrainScope, teamId: string, userId: string): Promise<boolean> {
  const connection = loadConnections(scope).find((c) => c.teamId === teamId && c.userId === userId);
  if (!connection) return false;
  await new WebClient(connection.accessToken).auth.revoke().catch(() => {});
  saveConnections(scope, loadConnections(scope).filter((c) => c !== connection));
  emitStatusChanged(scope);
  if (!anyConnection()) await slackSocket.stop();
  return true;
}

export async function disconnectAllSlack(scope: BrainScope): Promise<void> {
  for (const connection of [...loadConnections(scope)]) {
    await disconnectSlack(scope, connection.teamId, connection.userId);
  }
  if (existsSync(scope.slackTokensFile)) rmSync(scope.slackTokensFile, { force: true });
  connectionStore(scope).connections = [];
}

function ownerScopes(): BrainScope[] {
  return listBrainOwners()
    .map((owner) => (owner === ADMIN_BRAIN ? adminBrain() : userBrain(owner)))
    .filter((scope): scope is BrainScope => scope !== null);
}

function anyConnection(): boolean {
  return ownerScopes().some((scope) => loadConnections(scope).length > 0);
}

/** Quem, entre os brains, tem cada conta do Slack conectada: `${team}:${user}` → escopos. */
function connectionIndex(): Map<string, { scope: BrainScope; connection: SlackConnection }[]> {
  const index = new Map<string, { scope: BrainScope; connection: SlackConnection }[]>();
  for (const scope of ownerScopes()) {
    for (const connection of loadConnections(scope)) {
      if (connection.reauthRequired) continue;
      const key = `${connection.teamId}:${connection.userId}`;
      index.set(key, [...(index.get(key) ?? []), { scope, connection }]);
    }
  }
  return index;
}

interface NameCache {
  users: Map<string, string>;
  channels: Map<string, { name: string; type: string }>;
}

const nameCache = perScope((): Map<string, NameCache> => new Map());

function namesFor(scope: BrainScope, teamId: string): NameCache {
  const byTeam = nameCache(scope);
  let cache = byTeam.get(teamId);
  if (!cache) {
    cache = { users: new Map(), channels: new Map() };
    byTeam.set(teamId, cache);
  }
  return cache;
}

async function userName(web: WebClient, cache: NameCache, userId: string): Promise<string> {
  if (!userId) return "desconhecido";
  const cached = cache.users.get(userId);
  if (cached) return cached;
  try {
    const res = await web.users.info({ user: userId });
    const name = res.user?.profile?.display_name || res.user?.real_name || res.user?.name || userId;
    cache.users.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

async function channelInfo(web: WebClient, cache: NameCache, channelId: string): Promise<{ name: string; type: string }> {
  const cached = cache.channels.get(channelId);
  if (cached) return cached;
  try {
    const res = await web.conversations.info({ channel: channelId });
    const c = res.channel as { name?: string; is_im?: boolean; is_mpim?: boolean } | undefined;
    const type = c?.is_im ? "im" : c?.is_mpim ? "mpim" : "channel";
    const resolved = { name: c?.name ? `#${c.name}` : channelId, type };
    cache.channels.set(channelId, resolved);
    return resolved;
  } catch {
    return { name: channelId, type: "channel" };
  }
}

function messageText(event: SlackMessageEvent): string {
  const parts = [(event.text ?? "").trim()];
  for (const attachment of event.attachments ?? []) {
    const body = [attachment.pretext, attachment.title, attachment.text || attachment.fallback].filter(Boolean).join("\n").trim();
    if (body && !parts.includes(body)) parts.push(body);
  }
  for (const file of event.files ?? []) {
    const name = file.title || file.name;
    if (name) parts.push(`[arquivo: ${name}]`);
  }
  return parts.filter(Boolean).join("\n\n");
}

function ingestible(event: SlackMessageEvent): boolean {
  if (!event.channel || !event.ts) return false;
  if (event.subtype && !CONTENT_SUBTYPES.has(event.subtype)) return false;
  return Boolean(messageText(event));
}

async function senderOf(web: WebClient, cache: NameCache, event: SlackMessageEvent): Promise<{ name: string; handle: string }> {
  if (event.bot_id && !event.user) {
    return { name: event.username || event.bot_profile?.name || "bot", handle: `slack:bot:${event.bot_id}` };
  }
  return { name: await userName(web, cache, event.user ?? ""), handle: `slack:${event.user ?? "?"}` };
}

async function toCanonical(
  scope: BrainScope,
  connection: SlackConnection,
  event: SlackMessageEvent,
): Promise<CanonicalEvent> {
  const web = new WebClient(await freshToken(scope, connection));
  const cache = namesFor(scope, connection.teamId);
  const channel = await channelInfo(web, cache, event.channel!);
  const isDirect = event.channel_type ? event.channel_type === "im" : channel.type === "im";
  const sender = await senderOf(web, cache, event);
  const senderName = sender.name;
  const occurredMs = Number(event.ts!.split(".")[0]) * 1000;
  const threadPart = event.thread_ts ?? `${event.channel}:${dayKeyInTz(new Date(occurredMs), config.brainTz)}`;
  return {
    channel: "slack",
    subchannel: isDirect ? "direct" : "group",
    account: connection.teamName || connection.teamId,
    external_id: `slack:${connection.teamId}:${event.channel}:${event.ts}`,
    thread_key: `slack:${connection.teamId}:${threadPart}`,
    occurred_at: new Date(occurredMs).toISOString(),
    participants: [{ name: senderName, handle: sender.handle, role: "from" }],
    subject: isDirect ? `DM com ${channel.name}` : channel.name,
    body_text: messageText(event),
    attachments: [],
  };
}

async function deliver(scope: BrainScope, connection: SlackConnection, event: SlackMessageEvent): Promise<boolean> {
  const canonical = await toCanonical(scope, connection, event);
  if ((await emitCanonicalEvent(scope, canonical)) !== "emitted") return false;
  await incrMetric(scope, "events:slack");
  return true;
}

function accountKey(connection: SlackConnection): string {
  return `${connection.teamId}:${connection.userId}`;
}

function tsMs(ts: string | null | undefined): number {
  return ts ? Math.floor(Number(ts) * 1000) : 0;
}

function laterTs(a: string | null, b: string | undefined): string | null {
  if (!b) return a;
  return !a || Number(b) > Number(a) ? b : a;
}

function parsePoint(raw: string | undefined): SyncPoint | null {
  if (!raw) return null;
  try {
    const point = JSON.parse(raw) as Partial<SyncPoint>;
    return { ts: typeof point.ts === "string" ? point.ts : null, checkedAt: Number(point.checkedAt) || 0, activityAt: Number(point.activityAt) || 0 };
  } catch {
    return null;
  }
}

/** Conversas ativas são consultadas com frequência; as paradas, raramente. */
function due(point: SyncPoint, now: number): boolean {
  const idleFor = now - point.activityAt;
  const interval = idleFor < 2 * DAY_MS ? 5 * MINUTE_MS : idleFor < 30 * DAY_MS ? 30 * MINUTE_MS : 6 * 60 * MINUTE_MS;
  return now - point.checkedAt >= interval;
}

async function listConversations(web: WebClient, cache: NameCache): Promise<SlackConversation[]> {
  const conversations: SlackConversation[] = [];
  let cursor: string | undefined;
  do {
    const res = await web.conversations.list({ types: CONVERSATION_TYPES, exclude_archived: false, limit: 1000, cursor });
    for (const raw of (res.channels ?? []) as { id?: string; name?: string; is_im?: boolean; is_mpim?: boolean; user?: string }[]) {
      if (!raw.id) continue;
      const type = raw.is_im ? "im" : raw.is_mpim ? "mpim" : "channel";
      const name = raw.is_im ? await userName(web, cache, raw.user ?? "") : raw.name ? `#${raw.name}` : raw.id;
      cache.channels.set(raw.id, { name, type });
      conversations.push({ id: raw.id, name, type });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return conversations;
}

/** Todas as mensagens de `oldest` em diante, em ordem cronológica. */
async function readHistory(web: WebClient, channel: string, oldest: string | undefined): Promise<SlackMessageEvent[]> {
  const pages: SlackMessageEvent[][] = [];
  let cursor: string | undefined;
  do {
    const res = await web.conversations.history({ channel, oldest, inclusive: false, limit: HISTORY_PAGE_LIMIT, cursor });
    pages.push((res.messages ?? []) as SlackMessageEvent[]);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return pages.flat().reverse();
}

async function readReplies(web: WebClient, channel: string, threadTs: string, oldest: string | undefined): Promise<SlackMessageEvent[]> {
  const replies: SlackMessageEvent[] = [];
  let cursor: string | undefined;
  do {
    const res = await web.conversations.replies({ channel, ts: threadTs, oldest, inclusive: false, limit: HISTORY_PAGE_LIMIT, cursor });
    for (const message of (res.messages ?? []) as SlackMessageEvent[]) {
      if (message.ts !== threadTs && (!oldest || Number(message.ts) > Number(oldest))) replies.push(message);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return replies;
}

interface ConversationSync {
  scope: BrainScope;
  connection: SlackConnection;
  web: WebClient;
  conversation: SlackConversation;
}

/** Ingere as mensagens e devolve as threads que ganharam respostas, com a última resposta já conhecida. */
async function ingestMessages(ctx: ConversationSync, messages: SlackMessageEvent[], threads: Map<string, SyncPoint>): Promise<{ emitted: number; lastTs: string | null; repliesDue: { threadTs: string; oldest: string | null }[] }> {
  let emitted = 0;
  let lastTs: string | null = null;
  const repliesDue: { threadTs: string; oldest: string | null }[] = [];
  for (const message of messages) {
    lastTs = laterTs(lastTs, message.ts);
    const event = { ...message, channel: ctx.conversation.id };
    if (ingestible(event) && (await deliver(ctx.scope, ctx.connection, event))) emitted += 1;
    if (message.ts && message.reply_count && message.thread_ts === message.ts) {
      const known = threads.get(`${ctx.conversation.id}:${message.ts}`);
      if (!known?.ts || Number(message.latest_reply ?? 0) > Number(known.ts)) repliesDue.push({ threadTs: message.ts, oldest: known?.ts ?? null });
    }
  }
  return { emitted, lastTs, repliesDue };
}

async function syncThread(ctx: ConversationSync, threadTs: string, oldest: string | null, threads: Map<string, SyncPoint>, now: number): Promise<number> {
  const replies = await readReplies(ctx.web, ctx.conversation.id, threadTs, oldest ?? undefined);
  let emitted = 0;
  let lastTs = oldest;
  for (const reply of replies) {
    lastTs = laterTs(lastTs, reply.ts);
    const event = { ...reply, channel: ctx.conversation.id, thread_ts: threadTs };
    if (ingestible(event) && (await deliver(ctx.scope, ctx.connection, event))) emitted += 1;
  }
  const point: SyncPoint = { ts: lastTs ?? threadTs, checkedAt: now, activityAt: tsMs(lastTs ?? threadTs) };
  threads.set(`${ctx.conversation.id}:${threadTs}`, point);
  await getRedis().hset(brainKeys(ctx.scope).slackThreads(accountKey(ctx.connection)), `${ctx.conversation.id}:${threadTs}`, JSON.stringify(point));
  return emitted;
}

async function loadThreads(scope: BrainScope, connection: SlackConnection): Promise<Map<string, SyncPoint>> {
  const raw = (await getRedis().hgetall(brainKeys(scope).slackThreads(accountKey(connection)))) as Record<string, string>;
  const threads = new Map<string, SyncPoint>();
  for (const [key, value] of Object.entries(raw)) {
    const point = parsePoint(value);
    if (point) threads.set(key, point);
  }
  return threads;
}

/** Lê a conversa desde `oldest` (mensagens e respostas de thread) e devolve quantos eventos novos entraram. */
async function syncConversationFrom(ctx: ConversationSync, oldest: string | undefined, threads: Map<string, SyncPoint>, now: number): Promise<{ emitted: number; lastTs: string | null }> {
  const messages = await readHistory(ctx.web, ctx.conversation.id, oldest);
  const result = await ingestMessages(ctx, messages, threads);
  let emitted = result.emitted;
  for (const thread of result.repliesDue) emitted += await syncThread(ctx, thread.threadTs, thread.oldest, threads, now);
  return { emitted, lastTs: result.lastTs };
}

interface SlackSyncSummary {
  conversations: number;
  checked: number;
  emitted: number;
  finishedAt: string;
  error: string;
}

/**
 * Sincronização ativa pela Web API: varre todas as conversas que a conta conectada enxerga (canais públicos,
 * privados, DMs e grupos) e as respostas de thread, sem depender da entrega de eventos do Socket Mode.
 * Começa no momento da conexão; o histórico anterior entra pelo backfill.
 */
class SlackHistorySync {
  private running = new Set<string>();
  private conversations = new Map<string, { list: SlackConversation[]; at: number }>();
  private summaries = new Map<string, SlackSyncSummary>();

  summary(scope: BrainScope): SlackSyncSummary | undefined {
    return this.summaries.get(scope.owner);
  }

  async conversationsOf(scope: BrainScope, connection: SlackConnection, web: WebClient, refresh = false): Promise<SlackConversation[]> {
    const key = `${scope.owner}|${accountKey(connection)}`;
    const cached = this.conversations.get(key);
    if (!refresh && cached && Date.now() - cached.at < CONVERSATION_LIST_TTL_MS) return cached.list;
    const list = await listConversations(web, namesFor(scope, connection.teamId));
    this.conversations.set(key, { list, at: Date.now() });
    return list;
  }

  start(scope: BrainScope): void {
    if (this.running.has(scope.owner)) return;
    this.running.add(scope.owner);
    void this.run(scope).finally(() => this.running.delete(scope.owner));
  }

  private async run(scope: BrainScope): Promise<void> {
    const summary: SlackSyncSummary = { conversations: 0, checked: 0, emitted: 0, finishedAt: "", error: "" };
    for (const connection of loadConnections(scope)) {
      if (connection.reauthRequired) continue;
      try {
        await this.syncConnection(scope, connection, summary);
      } catch (err) {
        if (REVOKED_ERRORS.has(errorCode(err))) markReauthRequired(scope, connection);
        summary.error = `${connection.teamName}: ${errorCode(err)}`;
      }
    }
    summary.finishedAt = new Date().toISOString();
    this.summaries.set(scope.owner, summary);
    if (summary.emitted > 0) emitStatusChanged(scope);
  }

  private async syncConnection(scope: BrainScope, connection: SlackConnection, summary: SlackSyncSummary): Promise<void> {
    const web = new WebClient(await freshToken(scope, connection));
    const conversations = await this.conversationsOf(scope, connection, web);
    summary.conversations += conversations.length;
    const redis = getRedis();
    const stateKey = brainKeys(scope).slackSync(accountKey(connection));
    const stored = (await redis.hgetall(stateKey)) as Record<string, string>;
    const threads = await loadThreads(scope, connection);
    const startTs = (Date.parse(connection.connectedAt) / 1000).toFixed(6);
    for (const conversation of conversations) {
      const now = Date.now();
      const point = parsePoint(stored[conversation.id]) ?? { ts: startTs, checkedAt: 0, activityAt: 0 };
      if (!due(point, now)) continue;
      const ctx: ConversationSync = { scope, connection, web, conversation };
      try {
        const { emitted, lastTs } = await syncConversationFrom(ctx, point.ts ?? startTs, threads, now);
        summary.emitted += emitted;
        const ts = laterTs(point.ts, lastTs ?? undefined);
        await redis.hset(stateKey, conversation.id, JSON.stringify({ ts, checkedAt: now, activityAt: Math.max(point.activityAt, tsMs(lastTs)) }));
      } catch (err) {
        const code = errorCode(err);
        if (REVOKED_ERRORS.has(code)) throw err;
        if (code === "channel_not_found" || code === "not_in_channel" || code === "missing_scope") {
          await redis.hset(stateKey, conversation.id, JSON.stringify({ ...point, checkedAt: now }));
          continue;
        }
        summary.error = `${conversation.name}: ${code}`;
      }
      summary.checked += 1;
    }
    await this.followThreads(scope, connection, web, conversations, threads, summary);
  }

  /** Respostas novas em threads antigas não aparecem no histórico do canal: as threads recentes são revisitadas. */
  private async followThreads(scope: BrainScope, connection: SlackConnection, web: WebClient, conversations: SlackConversation[], threads: Map<string, SyncPoint>, summary: SlackSyncSummary): Promise<void> {
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    const key = brainKeys(scope).slackThreads(accountKey(connection));
    for (const [threadKey, point] of threads) {
      const now = Date.now();
      if (now - point.activityAt > THREAD_WATCH_MS) {
        await getRedis().hdel(key, threadKey);
        threads.delete(threadKey);
        continue;
      }
      if (!due(point, now)) continue;
      const [channel, threadTs] = threadKey.split(":");
      const conversation = byId.get(channel);
      if (!conversation || !threadTs) continue;
      try {
        summary.emitted += await syncThread({ scope, connection, web, conversation }, threadTs, point.ts, threads, now);
      } catch (err) {
        if (REVOKED_ERRORS.has(errorCode(err))) throw err;
        await getRedis().hdel(key, threadKey);
      }
    }
  }
}

export const slackHistorySync = new SlackHistorySync();

export interface SlackBackfillUnit {
  unit: string;
  label: string;
  run: () => Promise<number>;
}

/** Uma unidade de backfill por conversa de cada conta conectada: histórico desde `since`, com as respostas de thread. */
export async function slackBackfillUnits(scope: BrainScope, since: Date): Promise<SlackBackfillUnit[]> {
  const units: SlackBackfillUnit[] = [];
  const oldest = (since.getTime() / 1000).toFixed(6);
  for (const connection of loadConnections(scope)) {
    if (connection.reauthRequired) continue;
    const web = new WebClient(await freshToken(scope, connection));
    const conversations = await slackHistorySync.conversationsOf(scope, connection, web, true);
    for (const conversation of conversations) {
      units.push({
        unit: `slack|${accountKey(connection)}|${conversation.id}`,
        label: `slack ${connection.teamName} ${conversation.name}`,
        run: async () => {
          const ctx: ConversationSync = { scope, connection, web: new WebClient(await freshToken(scope, connection)), conversation };
          try {
            return (await syncConversationFrom(ctx, oldest, new Map(), Date.now())).emitted;
          } catch (err) {
            const code = errorCode(err);
            if (code === "channel_not_found" || code === "not_in_channel") return 0;
            if (REVOKED_ERRORS.has(code)) markReauthRequired(scope, connection);
            throw err;
          }
        },
      });
    }
  }
  return units;
}

export function slackConnected(scope: BrainScope): boolean {
  return loadConnections(scope).some((connection) => !connection.reauthRequired);
}

/**
 * Uma conexão Socket Mode para o app inteiro. O Slack entrega cada mensagem uma única vez, com uma
 * autorização de exemplo; a lista completa de quem a enxerga vem de apps.event.authorizations.list.
 * A mensagem só entra no brain dos donos cujas contas conectadas estão nessa lista.
 */
class SlackSocket {
  private socket: SocketModeClient | null = null;
  private starting = false;
  connected = false;
  lastError = "";

  alive(): boolean {
    return this.socket?.websocket?.isActive() === true;
  }

  /** A lista completa só é consultada quando a amostra não basta: mais de uma conta no workspace, ou amostra de outra instalação. */
  private async authorizationsOf(
    body: SlackEventBody,
    teamId: string,
    index: Map<string, { scope: BrainScope; connection: SlackConnection }[]>,
    teamConnections: number,
  ): Promise<SlackAuthorization[]> {
    const sample = body.authorizations ?? [];
    const sampleIsConnected = sample.some((a) => index.has(`${a.team_id ?? teamId}:${a.user_id ?? ""}`));
    if ((teamConnections <= 1 && sampleIsConnected) || !body.event_context) return sample;
    const all: SlackAuthorization[] = [];
    try {
      const web = new WebClient(config.slackAppToken);
      let cursor: string | undefined;
      do {
        const res = await web.apps.event.authorizations.list({ event_context: body.event_context, cursor });
        all.push(...((res.authorizations ?? []) as SlackAuthorization[]));
        cursor = res.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return all;
    } catch (err) {
      this.lastError = `apps.event.authorizations.list falhou (${errorCode(err)}) — confira o escopo authorizations:read do app token`;
      return sample;
    }
  }

  private async route(body: SlackEventBody, event: SlackMessageEvent): Promise<void> {
    if (!ingestible(event)) return;
    const teamId = body.team_id ?? event.team ?? "";
    const index = connectionIndex();
    const teamConnections = [...index.keys()].filter((key) => key.startsWith(`${teamId}:`)).length;
    if (teamConnections === 0) return;
    const authorizations = await this.authorizationsOf(body, teamId, index, teamConnections);
    const delivered = new Set<string>();
    for (const authorization of authorizations) {
      const key = `${authorization.team_id ?? teamId}:${authorization.user_id ?? ""}`;
      for (const { scope, connection } of index.get(key) ?? []) {
        if (delivered.has(scope.owner)) continue;
        delivered.add(scope.owner);
        await deliver(scope, connection, event).catch((err) => {
          if (REVOKED_ERRORS.has(errorCode(err))) markReauthRequired(scope, connection);
        });
      }
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.starting) return;
    if (this.connected && this.alive()) return;
    if (!slackConfigured()) throw new Error("SLACK_CLIENT_ID/SLACK_CLIENT_SECRET/SLACK_APP_TOKEN ausentes");
    if (!anyConnection()) return;
    this.starting = true;
    try {
      await this.dispose();
      const socket = new SocketModeClient({ appToken: config.slackAppToken });
      socket.on("message", (args: { body: SlackEventBody; event: SlackMessageEvent; ack: () => Promise<void> }) => {
        void (async () => {
          try {
            await args.ack();
            await this.route(args.body, args.event);
          } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
          }
        })();
      });
      socket.on("connected", () => {
        this.connected = true;
        this.lastError = "";
      });
      socket.on("reconnecting", () => {
        this.connected = false;
      });
      socket.on("disconnected", () => {
        this.connected = false;
      });
      this.socket = socket;
      await socket.start();
      this.connected = true;
      this.lastError = "";
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.connected = false;
      await this.dispose();
      throw err;
    } finally {
      this.starting = false;
    }
  }

  private async dispose(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners();
    await socket.disconnect().catch(() => {});
  }

  async stop(): Promise<void> {
    await this.dispose();
    this.connected = false;
  }
}

export const slackSocket = new SlackSocket();

async function verifyConnections(scope: BrainScope): Promise<string[]> {
  const problems: string[] = [];
  for (const connection of loadConnections(scope)) {
    if (connection.reauthRequired) {
      problems.push(`${connection.teamName}: reconecte a conta`);
      continue;
    }
    if (connection.lastVerifiedAt && Date.now() - connection.lastVerifiedAt < VERIFY_INTERVAL_MS) continue;
    try {
      await new WebClient(await freshToken(scope, connection)).auth.test();
      updateConnection(scope, connection.teamId, connection.userId, { lastVerifiedAt: Date.now() });
    } catch (err) {
      if (REVOKED_ERRORS.has(errorCode(err))) {
        markReauthRequired(scope, connection);
        problems.push(`${connection.teamName}: reconecte a conta`);
      }
    }
  }
  return problems;
}

export function slackConnectionIssues(scope: BrainScope): BrainConnectionIssue[] {
  const connections = loadConnections(scope);
  if (connections.length === 0 || !brainSettings(scope).get().schedulers.slack) return [];
  const issues: BrainConnectionIssue[] = connections
    .filter((c) => c.reauthRequired)
    .map((c) => ({ connector: "slack", account: `${c.teamName} (${c.userName})`, message: "a autorização foi revogada ou expirou — reconecte o Slack" }));
  if (slackConfigured() && !slackSocket.alive() && issues.length < connections.length) {
    issues.push({ connector: "slack", account: connections[0].teamName, message: "sem conexão em tempo real com o Slack" });
  }
  return issues;
}

brainSchedulers.register({
  name: "slack",
  cadenceMs: (s) => s.cadences.slackMs,
  disabledReason: (scope) => {
    if (!slackConfigured()) return "SLACK_CLIENT_ID/SLACK_CLIENT_SECRET/SLACK_APP_TOKEN ausentes";
    return loadConnections(scope).length > 0 ? null : "nenhuma conta Slack conectada";
  },
  run: async (scope) => {
    await slackSocket.ensureStarted().catch(() => {});
    const problems = await verifyConnections(scope);
    if (problems.length > 0) return `erro:${problems.join("; ")}`;
    slackHistorySync.start(scope);
    const last = slackHistorySync.summary(scope);
    if (last?.error) return `erro:sincronização do histórico — ${last.error}`;
    const socket = slackSocket.alive() ? "socket conectado" : "socket sem conexão (sincronização ativa segue)";
    if (!last) return `${socket} · primeira sincronização em andamento`;
    return `${socket} · ${last.conversations} conversa(s), ${last.checked} verificada(s), ${last.emitted} mensagem(ns) nova(s) na última rodada`;
  },
});
