import { Router } from "express";
import { runProcessManager } from "../../run-process-manager.js";

export const runConfigsRouter = Router();

runConfigsRouter.get("/", (_req, res) => {
  const configs = runProcessManager.getAllConfigs();
  const status = runProcessManager.getStatus();
  res.json(configs.map((c) => ({ ...c, status: status[c.id] ?? { running: false } })));
});

runConfigsRouter.post("/", (req, res) => {
  const { name, command, workingDirectory, envVars, projectName } = req.body;
  if (!name || !command) {
    res.status(400).json({ error: "name and command are required" });
    return;
  }
  const cfg = runProcessManager.createConfig({
    name,
    command,
    workingDirectory: workingDirectory || "",
    envVars: envVars || {},
    projectName: projectName || "",
  });
  res.json(cfg);
});

runConfigsRouter.put("/:id", (req, res) => {
  const updated = runProcessManager.updateConfig(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  res.json(updated);
});

runConfigsRouter.delete("/:id", (req, res) => {
  const deleted = runProcessManager.deleteConfig(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  res.json({ deleted: true });
});

runConfigsRouter.post("/:id/start", (req, res) => {
  const started = runProcessManager.startProcess(req.params.id);
  if (!started) {
    const cfg = runProcessManager.getConfig(req.params.id);
    if (!cfg) {
      res.status(404).json({ error: "Config not found" });
      return;
    }
    res.status(409).json({ error: "Already running" });
    return;
  }
  res.json({ started: true });
});

runConfigsRouter.post("/:id/stop", (req, res) => {
  const stopped = runProcessManager.stopProcess(req.params.id);
  if (!stopped) {
    res.status(404).json({ error: "Not running" });
    return;
  }
  res.json({ stopped: true });
});

runConfigsRouter.post("/:id/restart", (req, res) => {
  const cfg = runProcessManager.getConfig(req.params.id);
  if (!cfg) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  runProcessManager.restartProcess(req.params.id);
  res.json({ restarted: true });
});
