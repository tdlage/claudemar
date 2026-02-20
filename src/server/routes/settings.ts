import { Router } from "express";
import { settingsManager } from "../../settings-manager.js";
import { emailSettingsManager } from "../../email-settings-manager.js";
import { regenerateOrchestratorClaudeMd } from "../../orchestrator-init.js";
import { generateSendEmailScript } from "../../email-init.js";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(settingsManager.get());
});

settingsRouter.put("/", (req, res) => {
  const { sesFrom, adminEmail } = req.body;
  settingsManager.update({
    sesFrom: typeof sesFrom === "string" ? sesFrom : undefined,
    adminEmail: typeof adminEmail === "string" ? adminEmail : undefined,
  });
  regenerateOrchestratorClaudeMd();
  res.json(settingsManager.get());
});

settingsRouter.get("/email/profiles", (_req, res) => {
  res.json(emailSettingsManager.getProfiles());
});

settingsRouter.post("/email/profiles", (req, res) => {
  const { name, awsAccessKeyId, awsSecretAccessKey, region, from } = req.body;
  if (!name || !awsAccessKeyId || !awsSecretAccessKey || !region || !from) {
    res.status(400).json({ error: "All profile fields are required" });
    return;
  }
  try {
    const profile = emailSettingsManager.createProfile({ name, awsAccessKeyId, awsSecretAccessKey, region, from });
    generateSendEmailScript();
    res.status(201).json(profile);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Failed to create profile" });
  }
});

settingsRouter.put("/email/profiles/:name", (req, res) => {
  const updated = emailSettingsManager.updateProfile(req.params.name, req.body);
  if (!updated) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  generateSendEmailScript();
  res.json(updated);
});

settingsRouter.delete("/email/profiles/:name", (req, res) => {
  const deleted = emailSettingsManager.deleteProfile(req.params.name);
  if (!deleted) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  generateSendEmailScript();
  res.json({ deleted: true });
});

settingsRouter.post("/email/profiles/:name/test", async (req, res) => {
  const { to } = req.body;
  if (!to) {
    res.status(400).json({ error: "Recipient email (to) is required" });
    return;
  }
  try {
    const output = await emailSettingsManager.testProfile(req.params.name, to);
    res.json({ ok: true, output });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Test failed" });
  }
});
