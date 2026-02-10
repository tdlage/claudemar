import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "express";
import { config } from "../../config.js";
import { loadOrchestratorSettings, saveOrchestratorSettings } from "../../orchestrator-settings.js";

export const orchestratorRouter = Router();

const claudeMdPath = resolve(config.orchestratorPath, "CLAUDE.md");

orchestratorRouter.get("/settings", (_req, res) => {
  res.json(loadOrchestratorSettings());
});

orchestratorRouter.put("/settings", (req, res) => {
  const { prependPrompt, model } = req.body;
  saveOrchestratorSettings({
    prependPrompt: typeof prependPrompt === "string" ? prependPrompt : "",
    model: typeof model === "string" ? model : "claude-opus-4-6",
  });
  res.json({ ok: true });
});

orchestratorRouter.get("/claude-md", (_req, res) => {
  try {
    const content = readFileSync(claudeMdPath, "utf-8");
    res.json({ content });
  } catch {
    res.json({ content: "" });
  }
});

orchestratorRouter.put("/claude-md", (req, res) => {
  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content required" });
    return;
  }
  writeFileSync(claudeMdPath, content, "utf-8");
  res.json({ ok: true });
});
