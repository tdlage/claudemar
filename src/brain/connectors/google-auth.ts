import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import { config } from "../../config.js";
import { brainSettingsManager } from "../settings.js";
import type { GoogleAccountStatus } from "../types.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const tokensDir = resolve(config.dataPath, "brain-google-tokens");

interface StoredToken extends Credentials {
  email: string;
  reauth_required?: boolean;
}

function tokenPath(email: string): string {
  return resolve(tokensDir, `${email.toLowerCase().replace(/[^a-z0-9@._-]/g, "_")}.json`);
}

let tokenCache: Map<string, StoredToken> | null = null;

function loadTokens(): Map<string, StoredToken> {
  if (tokenCache) return tokenCache;
  const tokens = new Map<string, StoredToken>();
  try {
    for (const file of readdirSync(tokensDir).filter((f) => f.endsWith(".json"))) {
      try {
        const token = JSON.parse(readFileSync(resolve(tokensDir, file), "utf-8")) as StoredToken;
        const email = token.email?.toLowerCase();
        if (email) tokens.set(email, token);
      } catch {}
    }
  } catch {}
  tokenCache = tokens;
  return tokens;
}

function readToken(email: string): StoredToken | null {
  return loadTokens().get(email.trim().toLowerCase()) ?? null;
}

function writeToken(token: StoredToken): void {
  mkdirSync(tokensDir, { recursive: true });
  const path = tokenPath(token.email);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  loadTokens().set(token.email.toLowerCase(), token);
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

export async function handleCallback(code: string): Promise<string> {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = (profile.data.emailAddress ?? "").toLowerCase();
  if (!email) throw new Error("Google não retornou o email da conta");
  writeToken({ ...tokens, email, reauth_required: false });
  brainSettingsManager.upsertAccount(email);
  return email;
}

export function listConnectedEmails(): string[] {
  return [...loadTokens().keys()];
}

export function markReauthRequired(email: string): void {
  const token = readToken(email);
  if (token && !token.reauth_required) {
    token.reauth_required = true;
    writeToken(token);
  }
}

export function getAuthorizedClient(email: string): OAuth2Client | null {
  const token = readToken(email);
  if (!token || token.reauth_required || !googleConfigured()) return null;
  const client = newOAuthClient();
  client.setCredentials(token);
  client.on("tokens", (fresh) => {
    const current = readToken(email);
    if (!current) return;
    writeToken({ ...current, ...fresh, email, reauth_required: false });
  });
  return client;
}

export function isInvalidGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("invalid_grant") || msg.includes("invalid_rapt");
}

export async function disconnectAccount(email: string): Promise<void> {
  const token = readToken(email);
  if (token?.access_token || token?.refresh_token) {
    try {
      const client = newOAuthClient();
      await client.revokeToken((token.refresh_token ?? token.access_token) as string);
    } catch {}
  }
  const path = tokenPath(email);
  if (existsSync(path)) rmSync(path);
  loadTokens().delete(email.trim().toLowerCase());
  brainSettingsManager.removeAccount(email);
}

export function getAccountsStatus(): GoogleAccountStatus[] {
  const settings = brainSettingsManager.get();
  const connected = new Set(listConnectedEmails());
  const all = new Map<string, GoogleAccountStatus>();
  for (const account of settings.accounts) {
    const token = readToken(account.email);
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
      const token = readToken(email);
      all.set(email, {
        email,
        label: email,
        tenant: "personal",
        connected: !token?.reauth_required,
        reauthRequired: token?.reauth_required === true,
        expiryDate: token?.expiry_date ? new Date(token.expiry_date).toISOString() : null,
      });
    }
  }
  return [...all.values()].sort((a, b) => a.email.localeCompare(b.email, "en"));
}
