import { Router, type Response } from "express";
import { settingsManager } from "../../settings-manager.js";
import { EmailProfileError, emailSettingsManager, type EmailProfileInput } from "../../email-settings-manager.js";
import { isEmailAudience } from "../../email-profiles.js";
import { executionManager } from "../../execution-manager.js";
import { regenerateOrchestratorAgentsMd } from "../../orchestrator-init.js";
import { isAutoEffortOffset } from "../../jev/effort-offset.js";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(settingsManager.get());
});

settingsRouter.put("/", (req, res) => {
  const { sesFrom, adminEmail, llmProfiles, autoEffortOffset } = req.body;
  if (autoEffortOffset !== undefined && !isAutoEffortOffset(autoEffortOffset)) {
    res.status(400).json({ error: "Calibração de esforço inválida" });
    return;
  }
  const before = settingsManager.get();
  settingsManager.update({
    sesFrom: typeof sesFrom === "string" ? sesFrom : undefined,
    adminEmail: typeof adminEmail === "string" ? adminEmail : undefined,
    llmProfiles: Array.isArray(llmProfiles) ? llmProfiles : undefined,
    autoEffortOffset,
  });
  const after = settingsManager.get();
  const llmChanged =
    JSON.stringify(before.llmProfiles) !== JSON.stringify(after.llmProfiles);
  if (llmChanged) {
    executionManager.invalidateLlmSessions();
  }
  regenerateOrchestratorAgentsMd();
  res.json(after);
});

settingsRouter.get("/email/profiles", (_req, res) => {
  res.json(emailSettingsManager.getProfiles());
});

const PROFILE_TEXT_FIELDS = ["name", "awsAccessKeyId", "awsSecretAccessKey", "region", "from", "senderName", "userId"] as const;

function parseProfileInput(body: Record<string, unknown>): EmailProfileInput | string {
  const input: EmailProfileInput = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return `Invalid ${field}`;
    input[field] = value.trim();
  }
  if (body.audience !== undefined) {
    if (!isEmailAudience(body.audience)) return "audience must be one of: all, admin, user";
    input.audience = body.audience;
  }
  return input;
}

function sendProfileError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof EmailProfileError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : fallback });
}

settingsRouter.post("/email/profiles", (req, res) => {
  const input = parseProfileInput(req.body);
  const { credentialsFrom } = req.body;
  if (typeof input === "string" || (credentialsFrom !== undefined && typeof credentialsFrom !== "string")) {
    res.status(400).json({ error: typeof input === "string" ? input : "Invalid credentialsFrom" });
    return;
  }
  try {
    const profile = emailSettingsManager.createProfile({
      name: input.name ?? "",
      awsAccessKeyId: input.awsAccessKeyId ?? "",
      awsSecretAccessKey: input.awsSecretAccessKey ?? "",
      region: input.region ?? "",
      from: input.from ?? "",
      senderName: input.senderName ?? "",
      audience: input.audience ?? "admin",
      userId: input.userId ?? "",
    }, credentialsFrom || undefined);
    res.status(201).json(profile);
  } catch (err) {
    sendProfileError(res, err, "Failed to create profile");
  }
});

settingsRouter.put("/email/profiles/:name", (req, res) => {
  const input = parseProfileInput(req.body);
  if (typeof input === "string") {
    res.status(400).json({ error: input });
    return;
  }
  try {
    res.json(emailSettingsManager.updateProfile(req.params.name, input));
  } catch (err) {
    sendProfileError(res, err, "Failed to update profile");
  }
});

settingsRouter.delete("/email/profiles/:name", (req, res) => {
  const deleted = emailSettingsManager.deleteProfile(req.params.name);
  if (!deleted) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json({ deleted: true });
});

settingsRouter.post("/email/profiles/:name/test", async (req, res) => {
  const { to } = req.body;
  if (typeof to !== "string" || !to.trim()) {
    res.status(400).json({ error: "Recipient email (to) is required" });
    return;
  }
  try {
    const output = await emailSettingsManager.testProfile(req.params.name, to.trim());
    res.json({ ok: true, output });
  } catch (err) {
    sendProfileError(res, err, "Test failed");
  }
});
