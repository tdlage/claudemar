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
const CATCHUP_LIMIT = 200;
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
  text?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
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

function ingestible(event: SlackMessageEvent): boolean {
  if (!event.channel || !event.ts) return false;
  if (event.subtype && event.subtype !== "thread_broadcast" && event.subtype !== "file_share") return false;
  if (event.bot_id) return false;
  return Boolean((event.text ?? "").trim());
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
  const senderName = await userName(web, cache, event.user ?? "");
  const occurredMs = Number(event.ts!.split(".")[0]) * 1000;
  const threadPart = event.thread_ts ?? `${event.channel}:${dayKeyInTz(new Date(occurredMs), config.brainTz)}`;
  return {
    channel: "slack",
    subchannel: isDirect ? "direct" : "group",
    account: connection.teamName || connection.teamId,
    external_id: `slack:${connection.teamId}:${event.channel}:${event.ts}`,
    thread_key: `slack:${connection.teamId}:${threadPart}`,
    occurred_at: new Date(occurredMs).toISOString(),
    participants: [{ name: senderName, handle: `slack:${event.user ?? "?"}`, role: "from" }],
    subject: isDirect ? `DM com ${senderName}` : channel.name,
    body_text: (event.text ?? "").trim(),
    attachments: [],
  };
}

async function deliver(scope: BrainScope, connection: SlackConnection, event: SlackMessageEvent): Promise<void> {
  const canonical = await toCanonical(scope, connection, event);
  if ((await emitCanonicalEvent(scope, canonical)) !== "emitted") return;
  await incrMetric(scope, "events:slack");
  await getRedis().hset(brainKeys(scope).cursorSlack(connection.teamId), event.channel!, event.ts!).catch(() => {});
}

async function catchUp(scope: BrainScope, connection: SlackConnection): Promise<void> {
  const web = new WebClient(await freshToken(scope, connection));
  const cursors = (await getRedis()
    .hgetall(brainKeys(scope).cursorSlack(connection.teamId))
    .catch(() => ({}))) as Record<string, string>;
  for (const [channel, oldest] of Object.entries(cursors)) {
    try {
      const res = await web.conversations.history({ channel, oldest, limit: CATCHUP_LIMIT });
      const messages = (res.messages ?? []) as SlackMessageEvent[];
      for (const message of messages.reverse()) {
        if (message.ts === oldest || !ingestible({ ...message, channel })) continue;
        await deliver(scope, connection, { ...message, channel });
      }
    } catch (err) {
      if (REVOKED_ERRORS.has(errorCode(err))) {
        markReauthRequired(scope, connection);
        return;
      }
    }
  }
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
        void this.catchUpAll();
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

  private async catchUpAll(): Promise<void> {
    for (const scope of ownerScopes()) {
      for (const connection of loadConnections(scope)) {
        if (!connection.reauthRequired) await catchUp(scope, connection).catch(() => {});
      }
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
    await slackSocket.ensureStarted();
    const problems = await verifyConnections(scope);
    if (problems.length > 0) return `erro:${problems.join("; ")}`;
    return slackSocket.alive() ? "socket conectado" : `erro:${slackSocket.lastError || "socket sem conexão ativa"}`;
  },
});
