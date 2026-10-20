import { existsSync } from "node:fs";
import type { Request } from "express";
import { config } from "../config.js";
import { safeProjectPath } from "../session.js";
import { getAgentPaths } from "../agents/manager.js";

export interface AttachmentTarget {
  targetType: "orchestrator" | "project" | "agent";
  targetName: string;
}

export function resolveAttachmentTarget(req: Request, base: unknown): AttachmentTarget | null {
  if (!req.ctx || typeof base !== "string") return null;
  if (base === "orchestrator") {
    if (req.ctx.role !== "admin" || !existsSync(config.orchestratorPath)) return null;
    return { targetType: "orchestrator", targetName: "orchestrator" };
  }
  const [type, name, extra] = base.split(":");
  if (extra !== undefined || !name) return null;
  if (type === "project") {
    const path = safeProjectPath(name);
    if (!path || !existsSync(path)) return null;
    if (req.ctx.role === "user" && !req.ctx.projects.includes(name)) return null;
    return { targetType: "project", targetName: name };
  }
  if (type === "agent") {
    const paths = getAgentPaths(name);
    if (!paths || !existsSync(paths.root)) return null;
    if (req.ctx.role === "user" && !req.ctx.agents.includes(name)) return null;
    return { targetType: "agent", targetName: name };
  }
  return null;
}
