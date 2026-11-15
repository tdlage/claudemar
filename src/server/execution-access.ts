import type { ExecutionInfo } from "../execution-manager.js";
import type { RequestContext } from "./middleware.js";

export function canAccessExecution(ctx: RequestContext | undefined, info: ExecutionInfo | undefined): boolean {
  if (!ctx || !info) return false;
  if (ctx.role === "admin") return true;
  if (info.username && info.username === ctx.name) return true;
  if (info.targetType === "project") return ctx.projects.includes(info.targetName);
  if (info.targetType === "agent") return ctx.agents.includes(info.targetName);
  return false;
}
