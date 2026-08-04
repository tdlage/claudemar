import { Router, type Request } from "express";
import { passkeyManager } from "../passkey-manager.js";
import { requireAdmin } from "../middleware.js";

function requestHost(req: Request): string | undefined {
  const host = req.get("host");
  return host ?? undefined;
}

export const authRouter = Router();

authRouter.get("/me", (req, res) => {
  const ctx = req.ctx;
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (ctx.role === "admin") {
    res.json({ role: "admin" });
    return;
  }

  res.json({
    role: "user",
    id: ctx.userId,
    name: ctx.name,
    projects: ctx.projects,
    agents: ctx.agents,
    trackerProjects: ctx.trackerProjects,
    projectTabs: ctx.projectTabs,
  });
});

authRouter.get("/passkey/status", (_req, res) => {
  res.json({ enabled: passkeyManager.hasCredentials() });
});

authRouter.post("/passkey/register-options", requireAdmin, async (req, res) => {
  try {
    const { options, challenge } = await passkeyManager.generateRegistrationOptions("", requestHost(req));
    res.json({ options, challenge });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate registration options" });
  }
});

authRouter.post("/passkey/register", requireAdmin, async (req, res) => {
  try {
    const { name, challenge, response } = req.body as {
      name?: string;
      challenge: string;
      response: Record<string, unknown>;
    };
    const passkey = await passkeyManager.verifyRegistration(name ?? "", challenge, response as never, requestHost(req));
    res.json({ id: passkey.id, name: passkey.name });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

authRouter.post("/passkey/login-options", async (req, res) => {
  try {
    if (!passkeyManager.hasCredentials()) {
      res.status(400).json({ error: "Passkey not configured" });
      return;
    }
    const { options, challenge } = await passkeyManager.generateAuthenticationOptions(requestHost(req));
    res.json({ options, challenge });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate authentication options" });
  }
});

authRouter.post("/passkey/login", async (req, res) => {
  try {
    const { challenge, response } = req.body as {
      challenge: string;
      response: Record<string, unknown>;
    };
    const result = await passkeyManager.verifyAuthentication(challenge, response as never, requestHost(req));
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Authentication failed" });
  }
});

authRouter.get("/passkey/credentials", requireAdmin, (_req, res) => {
  const credentials = passkeyManager.getCredentials().map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
  }));
  res.json({ credentials });
});

authRouter.delete("/passkey/credentials/:id", requireAdmin, (req, res) => {
  const deleted = passkeyManager.deleteCredential(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Credential not found" });
    return;
  }
  res.json({ ok: true });
});
