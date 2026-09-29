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

runConfigsRouter.post("/", requireAdmin, async (req, res) => {
  const { name, command, workingDirectory, envVars, projectName, proxyDomain, proxyPort } = req.body;
  if (!name || !command) {
    res.status(400).json({ error: "name and command are required" });
    return;
  }
  const cfg = await runProcessManager.createConfig({
    name,
    command,
    workingDirectory: workingDirectory || "",
    envVars: envVars || {},
    projectName: projectName || "",
    proxyDomain: proxyDomain && proxyPort ? proxyDomain : undefined,
    proxyPort: proxyDomain && proxyPort ? Number(proxyPort) : undefined,
  });
  res.json(cfg);
});

runConfigsRouter.put("/:id", requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
  const updated = await runProcessManager.updateConfig(req.params.id, req.body);
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
