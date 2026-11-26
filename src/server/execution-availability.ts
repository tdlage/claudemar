import { executionManager } from "../execution-manager.js";
import { canAccessExecution } from "./execution-access.js";
import type { RequestContext } from "./middleware.js";

export type Availability = "playable" | "awaiting-input" | "not-running";

export function availabilityOf(ctx: RequestContext, execId: unknown): Availability {
  if (typeof execId !== "string" || !executionManager.isExecutionActive(execId)) return "not-running";
  const info = executionManager.getExecution(execId);
  if (!canAccessExecution(ctx, info)) return "not-running";
  if (info?.pendingQuestion || executionManager.getPendingPermissions(execId).length > 0) return "awaiting-input";
  return "playable";
}
