import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";
import { driveStore, type DriveAccount } from "./store.js";
import { driveErrorInfo } from "./drive-api.js";

const READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/drive";
const STATE_TTL_MS = 10 * 60_000;
const REAUTH_REASONS = new Set(["invalid_grant", "invalid_rapt", "unauthorized_client"]);

export interface PendingAuthorization {
  ownerId: string;
  returnTo: string | null;
  write: boolean;
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

const pendingAuthorizations = new Map<string, PendingAuthorization>();

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function driveOAuthConfigured(): boolean {
  return Boolean(config.googleDriveClientId && config.googleDriveClientSecret);
}

export function driveRedirectUri(): string {
  const base = config.publicBaseUrl || `http://localhost:${config.dashboardPort}`;
  return `${base.replace(/\/$/, "")}/api/google-drive/callback`;
}

function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(config.googleDriveClientId, config.googleDriveClientSecret, driveRedirectUri());
}

function pruneExpired(): void {
  const current = Date.now();
  for (const [state, pending] of pendingAuthorizations) {
    if (pending.expiresAt <= current) pendingAuthorizations.delete(state);
  }
}

export function authorizationCookieName(state: string): string {
  return `gdrive_oauth_${sha256(state).toString("hex").slice(0, 16)}`;
}

function grantedScopes(scope: string | null | undefined): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean);
}

export function accountCanWrite(account: DriveAccount): boolean {
  return grantedScopes(account.credentials.scope).includes(WRITE_SCOPE);
}

export interface AuthorizationRequest {
  write: boolean;
  loginHint?: string;
}

export function beginAuthorization(ownerId: string, returnTo: string | null, request: AuthorizationRequest): AuthorizationStart {
  pruneExpired();
  const state = randomBytes(24).toString("base64url");
  const browserKey = randomBytes(32).toString("base64url");
  pendingAuthorizations.set(state, { ownerId, returnTo, write: request.write, expiresAt: Date.now() + STATE_TTL_MS, browserKeyHash: sha256(browserKey) });
  const authUrl = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: [request.write ? WRITE_SCOPE : READ_SCOPE],
    include_granted_scopes: true,
    ...(request.loginHint ? { login_hint: request.loginHint } : {}),
    state,
  });
  return { authUrl, cookieName: authorizationCookieName(state), browserKey, maxAgeMs: STATE_TTL_MS };
}

export function claimAuthorization(state: string, browserKey: string | null): AuthorizationClaim {
  pruneExpired();
  const pending = pendingAuthorizations.get(state);
  if (!pending) return { status: "expired" };
  pendingAuthorizations.delete(state);
  if (!browserKey || !timingSafeEqual(sha256(browserKey), pending.browserKeyHash)) return { status: "other-browser", returnTo: pending.returnTo };
  return { status: "ok", pending };
}

export async function completeAuthorization(pending: PendingAuthorization, code: string): Promise<DriveAccount> {
  const { ownerId } = pending;
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  const granted = grantedScopes(tokens.scope);
  if (pending.write && !granted.includes(WRITE_SCOPE)) {
    throw new Error("Write access to Google Drive was not granted. Try again and allow Claudemar to see, edit, create and delete your Google Drive files.");
  }
  if (!granted.includes(READ_SCOPE) && !granted.includes(WRITE_SCOPE)) {
    throw new Error("Google Drive access was not granted. Connect again and allow Claudemar to see your Google Drive files.");
  }
  client.setCredentials(tokens);
  const { data } = await google.drive({ version: "v3", auth: client }).about.get({ fields: "user(displayName,emailAddress)" });
  const email = data.user?.emailAddress?.trim().toLowerCase();
  if (!email) throw new Error("Google did not return the email of the connected account.");
  const known = driveStore.accountsOf(ownerId).some((account) => account.email === email && account.credentials.refresh_token);
  if (!tokens.refresh_token && !known) {
    throw new Error("Google did not issue offline access. Remove Claudemar at myaccount.google.com/permissions and connect again.");
  }
  return driveStore.saveAccount(ownerId, email, data.user?.displayName ?? "", tokens);
}

export function authorizedClient(account: DriveAccount): OAuth2Client {
  const client = oauthClient();
  client.setCredentials(account.credentials);
  client.on("tokens", (fresh) => {
    driveStore.updateCredentials(account.id, fresh).catch((err) => {
      console.error(`[google-drive] failed to store refreshed token for ${account.email}:`, err instanceof Error ? err.message : String(err));
    });
  });
  return client;
}

export function isReauthError(err: unknown): boolean {
  const { status, reason } = driveErrorInfo(err);
  return status === 401 || (reason !== null && REAUTH_REASONS.has(reason));
}

export async function revokeAccess(account: DriveAccount): Promise<void> {
  const token = account.credentials.refresh_token || account.credentials.access_token;
  if (!token || !driveOAuthConfigured()) return;
  await oauthClient().revokeToken(token).catch((err) => {
    console.error(`[google-drive] failed to revoke access for ${account.email}:`, err instanceof Error ? err.message : String(err));
  });
}
