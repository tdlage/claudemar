import type { Request, Response, NextFunction } from "express";
import { tokenManager } from "./token-manager.js";
import { usersManager } from "../users-manager.js";

export type RequestContext =
  | { role: "admin" }
  | { role: "user"; userId: string; name: string; projects: string[]; agents: string[] };

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

  if (tokenManager.validate(token)) {
    req.ctx = { role: "admin" };
    next();
    return;
  }

  const user = token ? usersManager.findByToken(token) : null;
  if (user) {
    req.ctx = { role: "user", userId: user.id, name: user.name, projects: user.projects, agents: user.agents };
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.ctx || req.ctx.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function validateSocketToken(token: string): boolean {
  if (tokenManager.validate(token)) return true;
  return !!usersManager.findByToken(token);
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' wss: ws:; img-src 'self' data:; font-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdn.jsdelivr.net");
  next();
}
