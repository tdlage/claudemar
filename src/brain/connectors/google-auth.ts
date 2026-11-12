import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { config } from "../../config.js";
import { brainSettings } from "../settings.js";
import { emitStatusChanged } from "../events.js";
import { ROOT_TENANT } from "../tenants.js";
import { brainScope, listBrainOwners, perScope, type BrainScope } from "../scope.js";
import type { GoogleAccountStatus } from "../types.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

interface StoredToken extends Credentials {
  email: string;
  reauth_required?: boolean;
}

function tokenPath(scope: BrainScope, email: string): string {
  return resolve(scope.googleTokensDir, `${email.toLowerCase().replace(/[^a-z0-9@._-]/g, "_")}.json`);
}

const tokenCache = perScope((): { tokens: Map<string, StoredToken> | null } => ({ tokens: null }));

function loadTokens(scope: BrainScope): Map<string, StoredToken> {
  const cache = tokenCache(scope);
  if (cache.tokens) return cache.tokens;
  const tokens = new Map<string, StoredToken>();
  try {
    for (const file of readdirSync(scope.googleTokensDir).filter((f) => f.endsWith(".json"))) {
      try {
        const token = JSON.parse(readFileSync(resolve(scope.googleTokensDir, file), "utf-8")) as StoredToken;
        const email = token.email?.toLowerCase();
        if (email) tokens.set(email, token);
      } catch {}
    }
  } catch {}
  cache.tokens = tokens;
  return tokens;
}

function readToken(scope: BrainScope, email: string): StoredToken | null {
  return loadTokens(scope).get(email.trim().toLowerCase()) ?? null;
}

function writeToken(scope: BrainScope, token: StoredToken): void {
  mkdirSync(scope.googleTokensDir, { recursive: true, mode: 0o700 });
  const path = tokenPath(scope, token.email);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  loadTokens(scope).set(token.email.toLowerCase(), token);
}

export function googleConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

export function redirectUri(): string {
  const base = config.publicBaseUrl || `http://localhost:${config.dashboardPort}`;
  return `${base.replace(/\/$/, "")}/api/brain/google/callback`;
}

function newOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, redirectUri());
}

export function buildAuthUrl(state: string): string {
  return newOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: SCOPES,
    state,
  });
}

export async function handleCallback(scope: BrainScope, code: string): Promise<string> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = (profile.data.emailAddress ?? "").toLowerCase();
  if (!email) throw new Error("Google não retornou o email da conta");
  writeToken(scope, { ...tokens, email, reauth_required: false });
  brainSettings(scope).upsertAccount(email);
  emitStatusChanged(scope);
  return email;
}

export function listConnectedEmails(scope: BrainScope): string[] {
  return [...loadTokens(scope).keys()];
}

export function markReauthRequired(scope: BrainScope, email: string): void {
  const token = readToken(scope, email);
  if (token && !token.reauth_required) {
    token.reauth_required = true;
    writeToken(scope, token);
    emitStatusChanged(scope);
  }
}

export function getAuthorizedClient(scope: BrainScope, email: string): OAuth2Client | null {
  const token = readToken(scope, email);
  if (!token || token.reauth_required || !googleConfigured()) return null;
  const client = newOAuthClient();
  client.setCredentials(token);
  client.on("tokens", (fresh) => {
    const current = readToken(scope, email);
    if (!current) return;
    writeToken(scope, { ...current, ...fresh, email, reauth_required: false });
  });
  return client;
}

export function isInvalidGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("invalid_grant") || msg.includes("invalid_rapt");
}

/**
 * Revogar no Google derruba a concessão inteira daquela conta para o app — inclusive o token de
 * outro usuário do claudemar que tenha conectado a mesma conta. Só revoga quando ninguém mais a usa.
 */
function grantSharedWithOtherOwner(scope: BrainScope, email: string): boolean {
  return listBrainOwners().some((owner) => owner !== scope.owner && readToken(brainScope(owner), email) !== null);
}

export async function disconnectAccount(scope: BrainScope, email: string): Promise<void> {
  const token = readToken(scope, email);
  if ((token?.access_token || token?.refresh_token) && !grantSharedWithOtherOwner(scope, email)) {
    try {
      const client = newOAuthClient();
      await client.revokeToken((token.refresh_token ?? token.access_token) as string);
    } catch {}
  }
  const path = tokenPath(scope, email);
  if (existsSync(path)) rmSync(path);
  loadTokens(scope).delete(email.trim().toLowerCase());
  brainSettings(scope).removeAccount(email);
  emitStatusChanged(scope);
}

export async function disconnectAllAccounts(scope: BrainScope): Promise<void> {
  for (const email of listConnectedEmails(scope)) await disconnectAccount(scope, email);
}

export function getAccountsStatus(scope: BrainScope): GoogleAccountStatus[] {
  const settings = brainSettings(scope).get();
  const connected = new Set(listConnectedEmails(scope));
  const all = new Map<string, GoogleAccountStatus>();
  for (const account of settings.accounts) {
    const token = readToken(scope, account.email);
    all.set(account.email, {
      email: account.email,
      label: account.label,
      tenant: account.tenant,
      connected: connected.has(account.email) && !token?.reauth_required,
      reauthRequired: token?.reauth_required === true,
      expiryDate: token?.expiry_date ? new Date(token.expiry_date).toISOString() : null,
    });
  }
  for (const email of connected) {
    if (!all.has(email)) {
      const token = readToken(scope, email);
      all.set(email, {
        email,
        label: email,
        tenant: ROOT_TENANT,
        connected: !token?.reauth_required,
        reauthRequired: token?.reauth_required === true,
        expiryDate: token?.expiry_date ? new Date(token.expiry_date).toISOString() : null,
      });
    }
  }
  return [...all.values()].sort((a, b) => a.email.localeCompare(b.email, "en"));
}
