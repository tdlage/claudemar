import type { Request } from "express";
import rateLimit from "express-rate-limit";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { resolveContext, type RequestContext } from "./middleware.js";
import { passkeyManager } from "./passkey-manager.js";

type ReauthBody =
  | { method: "token"; token: string }
  | { method: "passkey"; challenge: string; response: AuthenticationResponseJSON };

export const reauthLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde um minuto e tente novamente." },
});

function sameIdentity(current: RequestContext, candidate: RequestContext | null): boolean {
  if (!candidate) return false;
  if (current.role === "admin") return candidate.role === "admin";
  return candidate.role === "user" && candidate.userId === current.userId;
}

export async function verifyReauthentication(req: Request): Promise<boolean> {
  const ctx = req.ctx;
  const body = req.body as Partial<ReauthBody> | undefined;
  if (!ctx || !body) return false;

  if (body.method === "token") {
    return typeof body.token === "string" && body.token.length > 0 && sameIdentity(ctx, resolveContext(body.token.trim()));
  }

  if (body.method === "passkey" && ctx.role === "admin" && typeof body.challenge === "string" && body.response) {
    try {
      const result = await passkeyManager.verifyAuthentication(body.challenge, body.response, req.get("host") ?? undefined);
      return result.verified;
    } catch {
      return false;
    }
  }

  return false;
}
