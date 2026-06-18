import type { Request, Response, NextFunction } from "express";
import { tokenManager } from "./token-manager.js";
import { usersManager } from "../users-manager.js";

export type RequestContext =
  | { role: "admin" }
  | { role: "user"; userId: string; name: string; projects: string[]; agents: string[]; trackerProjects: string[] };

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

export function resolveContext(token: string): RequestContext | null {
  if (tokenManager.validate(token)) return { role: "admin" };
  const user = token ? usersManager.findByToken(token) : null;
  if (user) {
    return { role: "user", userId: user.id, name: user.name, projects: user.projects, agents: user.agents, trackerProjects: user.trackerProjects };
  }
  return null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

  const ctx = resolveContext(token);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.ctx = ctx;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.ctx || req.ctx.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function validateSocketToken(token: string): boolean {
  return !!resolveContext(token);
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
