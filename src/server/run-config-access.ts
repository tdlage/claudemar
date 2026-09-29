import type { RunConfig } from "../run-process-manager.js";
import type { RequestContext } from "./middleware.js";

type RunStatus = { running: boolean; pid?: number; startedAt?: string };

export function canAccessRunConfig(ctx: RequestContext | undefined, cfg: RunConfig | undefined): cfg is RunConfig {
  if (!ctx || !cfg) return false;
  if (ctx.role === "admin") return true;
  return cfg.projectName !== "" && ctx.projects.includes(cfg.projectName);
}

export function runConfigView(ctx: RequestContext, cfg: RunConfig, status: RunStatus) {
  if (ctx.role === "admin") return { ...cfg, status };
  return {
    id: cfg.id,
    name: cfg.name,
    projectName: cfg.projectName,
    proxyDomain: cfg.proxyDomain,
    proxyPort: cfg.proxyPort,
    status: { running: status.running, startedAt: status.startedAt },
  };
}
