import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "express";
import { config } from "../../config.js";
import { loadOrchestratorSettings, saveOrchestratorSettings } from "../../orchestrator-settings.js";

export const orchestratorRouter = Router();

const agentsMdPath = resolve(config.orchestratorPath, "AGENTS.md");

orchestratorRouter.get("/settings", (_req, res) => {
  res.json(loadOrchestratorSettings());
});

orchestratorRouter.put("/settings", (req, res) => {
  const { prependPrompt, model } = req.body;
  saveOrchestratorSettings({
    prependPrompt: typeof prependPrompt === "string" ? prependPrompt : "",
    model: typeof model === "string" ? model : "codex",
  });
  res.json({ ok: true });
});

orchestratorRouter.get("/agents-md", (_req, res) => {
  try {
    const content = readFileSync(agentsMdPath, "utf-8");
    res.json({ content });
  } catch {
    res.json({ content: "" });
  }
});

orchestratorRouter.put("/agents-md", (req, res) => {
  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content required" });
    return;
  }
  writeFileSync(agentsMdPath, content, "utf-8");
  res.json({ ok: true });
});
