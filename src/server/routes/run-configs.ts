import { Router, type Request, type Response } from "express";
import { runProcessManager, type RunConfig } from "../../run-process-manager.js";
import { requireAdmin } from "../middleware.js";
import { canAccessRunConfig, runConfigView } from "../run-config-access.js";

export const runConfigsRouter = Router();

function accessibleConfig(req: Request, res: Response): RunConfig | null {
  const cfg = runProcessManager.getConfig(String(req.params.id));
  if (!canAccessRunConfig(req.ctx, cfg)) {
    res.status(404).json({ error: "Config not found" });
    return null;
  }
  return cfg;
}

runConfigsRouter.get("/", (req, res) => {
  const ctx = req.ctx!;
  const status = runProcessManager.getStatus();
  res.json(runProcessManager.getAllConfigs()
    .filter((c) => canAccessRunConfig(ctx, c))
    .map((c) => runConfigView(ctx, c, status[c.id] ?? { running: false })));
});

function ownerOf(body: Record<string, unknown>): { projectName: string; agentName: string } | null {
  const projectName = typeof body.projectName === "string" ? body.projectName : "";
  const agentName = typeof body.agentName === "string" ? body.agentName : "";
  return projectName && agentName ? null : { projectName, agentName };
}

runConfigsRouter.post("/", requireAdmin, async (req, res) => {
  const { name, command, workingDirectory, envVars, proxyDomain, proxyPort } = req.body;
  const owner = ownerOf(req.body ?? {});
  if (!name || !command) {
    res.status(400).json({ error: "name and command are required" });
    return;
  }
  if (!owner) {
    res.status(400).json({ error: "A configuration belongs to a project or to an agent, not both" });
    return;
  }
  const cfg = await runProcessManager.createConfig({
    name,
    command,
    workingDirectory: workingDirectory || "",
    envVars: envVars || {},
    ...owner,
    proxyDomain: proxyDomain && proxyPort ? proxyDomain : undefined,
    proxyPort: proxyDomain && proxyPort ? Number(proxyPort) : undefined,
  });
  res.json(cfg);
});

runConfigsRouter.put("/:id", requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
  const current = runProcessManager.getConfig(req.params.id);
  const owner = ownerOf({ projectName: current?.projectName, agentName: current?.agentName, ...req.body });
  if (!owner) {
    res.status(400).json({ error: "A configuration belongs to a project or to an agent, not both" });
    return;
  }
  const updated = await runProcessManager.updateConfig(req.params.id, { ...req.body, ...owner });
  if (!updated) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  res.json(updated);
});

runConfigsRouter.delete("/:id", requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
  const deleted = await runProcessManager.deleteConfig(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  res.json({ deleted: true });
});

runConfigsRouter.post("/:id/start", (req, res) => {
  const cfg = accessibleConfig(req, res);
  if (!cfg) return;
  if (!runProcessManager.startProcess(cfg.id)) {
    res.status(409).json({ error: "Already running" });
    return;
  }
  res.json({ started: true });
});

runConfigsRouter.post("/:id/stop", (req, res) => {
  const cfg = accessibleConfig(req, res);
  if (!cfg) return;
  if (!runProcessManager.stopProcess(cfg.id)) {
    res.status(404).json({ error: "Not running" });
    return;
  }
  res.json({ stopped: true });
});

runConfigsRouter.post("/:id/restart", (req, res) => {
  const cfg = accessibleConfig(req, res);
  if (!cfg) return;
  runProcessManager.restartProcess(cfg.id);
  res.json({ restarted: true });
});
