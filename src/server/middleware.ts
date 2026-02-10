import type { Request, Response, NextFunction } from "express";
import { tokenManager } from "./token-manager.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

  if (!tokenManager.validate(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

export function validateSocketToken(token: string): boolean {
  return tokenManager.validate(token);
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}
