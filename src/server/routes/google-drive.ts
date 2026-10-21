import { Router } from "express";
import type { Request, Response } from "express";
import { isValidAgentName } from "../../agents/manager.js";
import {
  authorizationCookieName,
  authorizedClient,
  beginAuthorization,
  claimAuthorization,
  completeAuthorization,
  driveOAuthConfigured,
  driveRedirectUri,
  isReauthError,
} from "../../google-drive/oauth.js";
import { browseFolders, driveClient, driveErrorInfo, DRIVE_ID_PATTERN, type BrowseScope } from "../../google-drive/drive-api.js";
import { accountViews, disconnectAccount, DriveRequestError, ownedAccount, ownerIdOf, resumeAccount } from "../../google-drive/service.js";
import { driveStore } from "../../google-drive/store.js";
import { REAUTH_MESSAGE } from "../../google-drive/sync.js";
import { sendCallbackPage } from "../callback-page.js";

export const googleDriveRouter = Router();
export const googleDrivePublicRouter = Router();

const BROADCAST_CHANNEL = "claudemar-google-drive";
const MAX_SEARCH_LENGTH = 100;
const MAX_PAGE_TOKEN_LENGTH = 2048;

export function driveRoute(handler: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((err) => {
      if (res.headersSent) {
        res.destroy(err instanceof Error ? err : undefined);
        return;
      }
      if (err instanceof DriveRequestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (isReauthError(err)) {
        res.status(409).json({ error: REAUTH_MESSAGE });
        return;
      }
      const { status, message } = driveErrorInfo(err);
      console.error("[google-drive] request failed:", message);
      res.status(status !== null && status >= 400 && status < 500 ? 502 : 500).json({ error: message });
    });
  };
}

function queryParam(req: Request, key: string): string | null {
  const value = req.query[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function driveIdParam(req: Request, key: string): string | null {
  const value = queryParam(req, key);
  if (value !== null && !DRIVE_ID_PATTERN.test(value)) throw new DriveRequestError(400, `Invalid ${key}`);
  return value;
}

function returnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/agents\/([^/]+)$/.exec(value);
  return match && isValidAgentName(match[1]) ? value : null;
}

googleDriveRouter.get("/accounts", (req, res) => {
  const ctx = req.ctx!;
  res.json({
    configured: driveOAuthConfigured(),
    redirectUri: ctx.role === "admin" ? driveRedirectUri() : null,
    accounts: accountViews(ctx),
  });
});

googleDriveRouter.post("/accounts/connect", (req, res) => {
  if (!driveOAuthConfigured()) {
    res.status(400).json({ error: "Google Drive is not configured on this server" });
    return;
  }
  const start = beginAuthorization(ownerIdOf(req.ctx!), returnPath(req.body?.returnTo));
  res.cookie(start.cookieName, start.browserKey, { ...authorizationCookieOptions(req), maxAge: start.maxAgeMs });
  res.json({ authUrl: start.authUrl });
});

googleDriveRouter.delete("/accounts/:id", driveRoute(async (req, res) => {
  await disconnectAccount(req.ctx!, String(req.params.id));
  res.json({ disconnected: true });
}));

googleDriveRouter.get("/accounts/:id/folders", driveRoute(async (req, res) => {
  const account = ownedAccount(req.ctx!, String(req.params.id));
  if (account.reauthRequired) throw new DriveRequestError(409, REAUTH_MESSAGE);
  const scopeParam = queryParam(req, "scope");
  const scope: BrowseScope = scopeParam === "shared" || scopeParam === "drives" ? scopeParam : "my";
  const search = queryParam(req, "q")?.trim().slice(0, MAX_SEARCH_LENGTH) || null;
  const pageToken = queryParam(req, "pageToken");
  if (pageToken && pageToken.length > MAX_PAGE_TOKEN_LENGTH) throw new DriveRequestError(400, "Invalid pageToken");
  try {
    res.json(await browseFolders(driveClient(authorizedClient(account)), {
      scope,
      parentId: driveIdParam(req, "parent"),
      driveId: driveIdParam(req, "driveId"),
      search,
      pageToken,
    }));
  } catch (err) {
    if (isReauthError(err)) await driveStore.markReauthRequired(account.id);
    throw err;
  }
}));

interface DriveCallbackPage {
  ok: boolean;
  title: string;
  message: string;
  returnTo: string;
  accountId?: string;
}

function sendDriveCallback(res: Response, status: number, page: DriveCallbackPage): void {
  const event = JSON.stringify({ type: page.ok ? "connected" : "error", message: page.message, accountId: page.accountId }).replace(/</g, "\\u003c");
  sendCallbackPage(res, status, {
    lang: "en",
    title: page.title,
    message: page.message,
    link: { href: page.returnTo, label: "Return to Claudemar" },
    script: `try{var channel=new BroadcastChannel(${JSON.stringify(BROADCAST_CHANNEL)});channel.postMessage(${event});channel.close();setTimeout(function(){window.close()},700)}catch(e){}`,
  });
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function authorizationCookieOptions(req: Request) {
  return { httpOnly: true, sameSite: "lax" as const, secure: req.secure, path: `${req.baseUrl}/callback` };
}

googleDrivePublicRouter.get("/callback", driveRoute(async (req, res) => {
  const state = queryParam(req, "state");
  if (!state) {
    sendDriveCallback(res, 400, { ok: false, title: "Authorization expired", message: "Start the connection again from Claudemar.", returnTo: "/" });
    return;
  }
  const cookieName = authorizationCookieName(state);
  const claim = claimAuthorization(state, readCookie(req, cookieName));
  res.clearCookie(cookieName, authorizationCookieOptions(req));
  if (claim.status === "expired") {
    sendDriveCallback(res, 400, { ok: false, title: "Authorization expired", message: "Start the connection again from Claudemar.", returnTo: "/" });
    return;
  }
  if (claim.status === "other-browser") {
    const message = "This authorization was started from another browser or session. Start the connection again from Claudemar in this browser.";
    sendDriveCallback(res, 403, { ok: false, title: "Authorization rejected", message, returnTo: claim.returnTo ?? "/" });
    return;
  }
  const { pending } = claim;
  const returnTo = pending.returnTo ?? "/";
  const error = queryParam(req, "error");
  if (error) {
    const message = error === "access_denied" ? "Access to Google Drive was not granted." : `Google returned an error: ${error}`;
    sendDriveCallback(res, 400, { ok: false, title: "Authorization cancelled", message, returnTo });
    return;
  }
  const code = queryParam(req, "code");
  if (!code) {
    sendDriveCallback(res, 400, { ok: false, title: "Authorization failed", message: "Google did not return an authorization code.", returnTo });
    return;
  }
  try {
    const account = await completeAuthorization(pending.ownerId, code);
    resumeAccount(account.id);
    sendDriveCallback(res, 200, { ok: true, title: "Google Drive connected", message: `${account.email} is connected. You can close this window.`, returnTo, accountId: account.id });
  } catch (err) {
    sendDriveCallback(res, 400, { ok: false, title: "Connection failed", message: driveErrorInfo(err).message, returnTo });
  }
}));
