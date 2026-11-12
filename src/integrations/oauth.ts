import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { InvalidClientError, InvalidGrantError, UnauthorizedClientError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationServerMetadata, OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config.js";
import { callbackUri, PROVIDERS, type AccountIdentity, type IntegrationProvider, type ProviderSpec } from "./providers.js";
import { integrationStore, type IntegrationAccount, type IntegrationCredentials } from "./store.js";

const DISCOVERY_TTL_MS = 6 * 60 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 2 * 60_000;
const CLIENT_NAME = "Claudemar";

export class ReauthRequiredError extends Error {
  constructor(readonly account: IntegrationAccount) {
    super(`The ${PROVIDERS[account.provider].label} connection "${account.name}" expired or was revoked. Reconnect it in the agent's Integrations tab.`);
  }
}

interface ServerInfo {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata | undefined;
  resource: URL | undefined;
  scope: string | undefined;
}

export interface AuthorizationTarget {
  agentName: string | null;
  accountId: string | null;
  returnTo: string | null;
}

export interface PendingAuthorization extends AuthorizationTarget {
  provider: IntegrationProvider;
  ownerId: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
  expiresAt: number;
  browserKeyHash: Buffer;
}

export interface AuthorizationStart {
  authUrl: string;
  cookieName: string;
  browserKey: string;
  maxAgeMs: number;
}

export type AuthorizationClaim =
  | { status: "ok"; pending: PendingAuthorization }
  | { status: "expired" }
  | { status: "other-browser"; returnTo: string | null };

export interface CompletedAuthorization {
  identity: AccountIdentity | null;
  clientId: string;
  credentials: IntegrationCredentials;
}

const discoveries = new Map<IntegrationProvider, { info: Promise<ServerInfo>; expiresAt: number }>();
const registrations = new Map<IntegrationProvider, Promise<OAuthClientInformationMixed>>();
const pendingAuthorizations = new Map<string, PendingAuthorization>();
const refreshes = new Map<string, Promise<string>>();

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

async function discover(spec: ProviderSpec): Promise<ServerInfo> {
  const found = await discoverOAuthServerInfo(spec.mcpUrl);
  const resource = spec.resource ?? found.resourceMetadata?.resource;
  const scopes = found.resourceMetadata?.scopes_supported ?? [];
  return {
    authorizationServerUrl: found.authorizationServerUrl,
    metadata: found.authorizationServerMetadata,
    resource: resource ? new URL(resource) : undefined,
    scope: spec.requestScopes && scopes.length > 0 ? scopes.join(" ") : undefined,
  };
}

function serverInfo(provider: IntegrationProvider): Promise<ServerInfo> {
  const cached = discoveries.get(provider);
  if (cached && cached.expiresAt > Date.now()) return cached.info;
  const info = discover(PROVIDERS[provider]);
  discoveries.set(provider, { info, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  info.catch(() => {
    if (discoveries.get(provider)?.info === info) discoveries.delete(provider);
  });
  return info;
}

function staticClient(spec: ProviderSpec): OAuthClientInformationMixed | null {
  if (spec.registration.kind !== "static") return null;
  const clientId = spec.registration.clientId();
  const clientSecret = spec.registration.clientSecret();
  return clientId && clientSecret ? { client_id: clientId, client_secret: clientSecret } : null;
}

async function registeredClient(spec: ProviderSpec, info: ServerInfo, redirectUri: string): Promise<OAuthClientInformationMixed> {
  const existing = integrationStore.clientFor(spec.id, redirectUri);
  if (existing) return existing;
  const running = registrations.get(spec.id);
  if (running) return running;
  const registration = registerClient(info.authorizationServerUrl, {
    metadata: info.metadata,
    scope: info.scope,
    clientMetadata: {
      client_name: CLIENT_NAME,
      ...(config.publicBaseUrl ? { client_uri: config.publicBaseUrl } : {}),
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  }).then(async (client) => {
    await integrationStore.saveClient(spec.id, redirectUri, client);
    return client;
  });
  registrations.set(spec.id, registration);
  try {
    return await registration;
  } finally {
    registrations.delete(spec.id);
  }
}

async function clientForAuthorization(spec: ProviderSpec, info: ServerInfo, redirectUri: string): Promise<OAuthClientInformationMixed> {
  if (spec.registration.kind === "dynamic") return registeredClient(spec, info, redirectUri);
  const client = staticClient(spec);
  if (!client) throw new Error(`${spec.label} is not configured on this server`);
  return client;
}

function clientFor(provider: IntegrationProvider, clientId: string): OAuthClientInformationMixed | null {
  const spec = PROVIDERS[provider];
  if (spec.registration.kind === "dynamic") return integrationStore.clientById(provider, clientId);
  const client = staticClient(spec);
  return client && client.client_id === clientId ? client : null;
}

function pruneExpired(): void {
  const current = Date.now();
  for (const [state, pending] of pendingAuthorizations) {
    if (pending.expiresAt <= current) pendingAuthorizations.delete(state);
  }
}

export function authorizationCookieName(state: string): string {
  return `integration_oauth_${sha256(state).toString("hex").slice(0, 16)}`;
}

export async function beginAuthorization(provider: IntegrationProvider, ownerId: string, target: AuthorizationTarget): Promise<AuthorizationStart> {
  pruneExpired();
  const spec = PROVIDERS[provider];
  const info = await serverInfo(provider);
  const redirectUri = callbackUri(provider);
  const client = await clientForAuthorization(spec, info, redirectUri);
  const state = randomBytes(24).toString("base64url");
  const browserKey = randomBytes(32).toString("base64url");
  const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, {
    metadata: info.metadata,
    clientInformation: client,
    redirectUrl: redirectUri,
    scope: info.scope,
    state,
    resource: info.resource,
  });
  for (const [key, value] of Object.entries(spec.extraAuthorizationParams)) authorizationUrl.searchParams.set(key, value);
  pendingAuthorizations.set(state, {
    ...target,
    provider,
    ownerId,
    redirectUri,
    clientId: client.client_id,
    codeVerifier,
    expiresAt: Date.now() + STATE_TTL_MS,
    browserKeyHash: sha256(browserKey),
  });
  return { authUrl: authorizationUrl.toString(), cookieName: authorizationCookieName(state), browserKey, maxAgeMs: STATE_TTL_MS };
}

export function claimAuthorization(provider: IntegrationProvider, state: string, browserKey: string | null): AuthorizationClaim {
  pruneExpired();
  const pending = pendingAuthorizations.get(state);
  if (!pending || pending.provider !== provider) return { status: "expired" };
  pendingAuthorizations.delete(state);
  if (!browserKey || !timingSafeEqual(sha256(browserKey), pending.browserKeyHash)) return { status: "other-browser", returnTo: pending.returnTo };
  return { status: "ok", pending };
}

function toCredentials(tokens: OAuthTokens, previous: IntegrationCredentials | null): IntegrationCredentials {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || previous?.refreshToken || null,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
    scope: tokens.scope ?? previous?.scope ?? null,
  };
}

// O SDK descarta campos extras da resposta de token; a identidade da conta (usuário do Asana,
// workspace do Notion) só vem nela, então a resposta crua é lida de uma cópia.
function capturingFetch(sink: (body: Record<string, unknown>) => void): FetchLike {
  return async (url, init) => {
    const response = await fetch(url, init);
    if (response.ok) {
      const body = await response.clone().json().catch(() => null) as unknown;
      if (body && typeof body === "object") sink(body as Record<string, unknown>);
    }
    return response;
  };
}

export async function completeAuthorization(pending: PendingAuthorization, code: string): Promise<CompletedAuthorization> {
  const spec = PROVIDERS[pending.provider];
  const info = await serverInfo(pending.provider);
  const client = clientFor(pending.provider, pending.clientId);
  if (!client) throw new Error(`The ${spec.label} OAuth client changed during the authorization. Connect again.`);
  let raw: Record<string, unknown> = {};
  const tokens = await exchangeAuthorization(info.authorizationServerUrl, {
    metadata: info.metadata,
    clientInformation: client,
    authorizationCode: code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
    resource: info.resource,
    fetchFn: capturingFetch((body) => { raw = body; }),
  });
  if (!tokens.refresh_token) throw new Error(`${spec.label} did not issue a refresh token, so the connection would stop working within hours. Connect again.`);
  return { identity: spec.identity(raw), clientId: client.client_id, credentials: toCredentials(tokens, null) };
}

function isUsable(credentials: IntegrationCredentials, staleToken: string | undefined): boolean {
  if (!credentials.accessToken || credentials.accessToken === staleToken) return false;
  return credentials.expiresAt === null || credentials.expiresAt - REFRESH_SKEW_MS > Date.now();
}

function isRevokedGrant(err: unknown): boolean {
  return err instanceof InvalidGrantError || err instanceof InvalidClientError || err instanceof UnauthorizedClientError;
}

async function refresh(account: IntegrationAccount, staleToken: string | undefined): Promise<string> {
  const locked = await integrationStore.lockCredentials(account.id, async (current) => {
    if (current.reauthRequired) return { kind: "keep" };
    if (isUsable(current.credentials, staleToken)) return { kind: "keep" };
    const client = clientFor(account.provider, account.clientId);
    if (!client || !current.credentials.refreshToken) return { kind: "reauth" };
    const info = await serverInfo(account.provider);
    try {
      const tokens = await refreshAuthorization(info.authorizationServerUrl, {
        metadata: info.metadata,
        clientInformation: client,
        refreshToken: current.credentials.refreshToken,
        resource: info.resource,
      });
      return { kind: "refreshed", credentials: toCredentials(tokens, current.credentials) };
    } catch (err) {
      if (isRevokedGrant(err)) return { kind: "reauth" };
      throw err;
    }
  });
  if (!locked || locked.reauthRequired || !locked.credentials.accessToken) throw new ReauthRequiredError(account);
  return locked.credentials.accessToken;
}

// Devolve um access token válido; `staleToken` força a renovação quando o servidor recusou esse token.
export async function accessToken(accountId: string, staleToken?: string): Promise<string> {
  const account = integrationStore.getAccount(accountId);
  if (!account) throw new Error("This integration account was disconnected.");
  if (account.reauthRequired) throw new ReauthRequiredError(account);
  if (isUsable(account.credentials, staleToken)) return account.credentials.accessToken;
  const running = refreshes.get(accountId);
  if (running) return running;
  const task = refresh(account, staleToken).finally(() => refreshes.delete(accountId));
  refreshes.set(accountId, task);
  return task;
}

export async function renewAccount(account: IntegrationAccount): Promise<void> {
  await accessToken(account.id, account.credentials.accessToken);
}

export async function revokeCredentials(provider: IntegrationProvider, clientId: string, credentials: IntegrationCredentials): Promise<void> {
  const token = credentials.refreshToken || credentials.accessToken;
  const client = clientFor(provider, clientId);
  if (!token || !client) return;
  try {
    const info = await serverInfo(provider);
    const endpoint = info.metadata && "revocation_endpoint" in info.metadata ? info.metadata.revocation_endpoint : undefined;
    if (typeof endpoint !== "string" || !endpoint) return;
    const body = new URLSearchParams({ token, token_type_hint: credentials.refreshToken ? "refresh_token" : "access_token", client_id: client.client_id });
    if (client.client_secret) body.set("client_secret", client.client_secret);
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    console.error(`[integrations] failed to revoke ${PROVIDERS[provider].label} access:`, err instanceof Error ? err.message : String(err));
  }
}
