import { randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";

// Constantes extraídas do Agent SDK instalado (fonte de verdade). Sobrescrevíveis por env
// caso a Anthropic mude os endpoints numa versão futura do CLI.
const CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = process.env.CLAUDE_OAUTH_AUTHORIZE_URL || "https://platform.claude.com/oauth/authorize";
const TOKEN_URL = process.env.CLAUDE_OAUTH_TOKEN_URL || "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = process.env.CLAUDE_OAUTH_REDIRECT_URI || "https://platform.claude.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";
const PENDING_TTL_MS = 15 * 60 * 1000;
const FALLBACK_EXPIRY_MS = 8 * 60 * 60 * 1000;

function credentialsPath(): string {
  return resolve(homedir(), ".claude", ".credentials.json");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface PendingLogin {
  verifier: string;
  state: string;
  createdAt: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

let pending: PendingLogin | null = null;

export function startClaudeLogin(): { url: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));
  pending = { verifier, state, createdAt: Date.now() };

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return { url: url.toString() };
}

export async function completeClaudeLogin(rawCode: string): Promise<{ expiresAt: number }> {
  if (!pending) throw new Error("Nenhum login em andamento — gere a URL novamente.");
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    pending = null;
    throw new Error("Login expirado — gere a URL novamente.");
  }

  const input = (rawCode || "").trim();
  if (!input) throw new Error("Código vazio.");
  const [code, stateFromCode] = input.split("#");
  const state = stateFromCode || pending.state;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      state,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Falha na troca do código (${response.status}). ${text.slice(0, 300)}`.trim());
  }

  const data = await response.json().catch(() => ({})) as TokenResponse;
  if (!data.access_token) throw new Error("Resposta do servidor sem access_token.");

  const expiresAt = Date.now() + (data.expires_in ? data.expires_in * 1000 : FALLBACK_EXPIRY_MS);
  writeCredentials({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    scopes: data.scope ? data.scope.split(" ") : SCOPES.split(" "),
  });
  pending = null;
  return { expiresAt };
}

function writeCredentials(oauth: { accessToken: string; refreshToken?: string; expiresAt: number; scopes: string[] }): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const prev = (existing.claudeAiOauth as Record<string, unknown> | undefined) ?? {};
  existing.claudeAiOauth = {
    ...prev,
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken ?? prev.refreshToken,
    expiresAt: oauth.expiresAt,
    scopes: oauth.scopes,
  };

  writeFileSync(path, JSON.stringify(existing, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function getClaudeAuthStatus(): { present: boolean; expiresAt: number | null; expired: boolean } {
  const path = credentialsPath();
  if (!existsSync(path)) return { present: false, expiresAt: null, expired: true };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const oauth = raw?.claudeAiOauth;
    if (!oauth?.accessToken) return { present: false, expiresAt: null, expired: true };
    const expiresAt = typeof oauth.expiresAt === "number" ? oauth.expiresAt : null;
    const expired = expiresAt != null ? Date.now() >= expiresAt : false;
    return { present: true, expiresAt, expired };
  } catch {
    return { present: false, expiresAt: null, expired: true };
  }
}
