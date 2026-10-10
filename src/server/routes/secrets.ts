import { createReadStream, existsSync, statSync } from "node:fs";
import type { Request, Response, Router } from "express";
import type { SecretsManager } from "../../secrets-manager.js";
import { safeFilename } from "../route-utils.js";
import { reauthLimiter, verifyReauthentication } from "../reauth.js";

const MAX_SECRET_FILE_BYTES = 10 * 1024 * 1024;

export interface SecretsRoutesOptions {
  manager: SecretsManager;
  ownerLabel: string;
  resolveOwner: (req: Request, res: Response) => string | null;
}

export function registerSecretsRoutes(router: Router, { manager, ownerLabel, resolveOwner }: SecretsRoutesOptions): void {
  router.get("/:name/secrets", async (req, res) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;
    res.json(await manager.getMaskedSecrets(owner));
  });

  router.post("/:name/secrets", async (req, res) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const { name: secretName, value, description } = req.body;
    if (!secretName || typeof secretName !== "string") {
      res.status(400).json({ error: "name (string) required" });
      return;
    }
    if (!value || typeof value !== "string") {
      res.status(400).json({ error: "value (string) required" });
      return;
    }

    const created = await manager.createSecret(owner, secretName, value, typeof description === "string" ? description : "");
    res.status(201).json(created);
  });

  router.post("/:name/secrets/:id/reveal", reauthLimiter, async (req: Request<{ name: string; id: string }>, res: Response) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;
    if (!(await verifyReauthentication(req))) {
      res.status(403).json({ error: "Não foi possível confirmar sua identidade." });
      return;
    }
    const secret = await manager.getSecret(owner, req.params.id);
    if (!secret) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    const who = req.ctx?.role === "user" ? `user ${req.ctx.name}` : "admin";
    console.log(`[secrets] ${who} revelou o valor de ${ownerLabel} ${owner}/${secret.name}`);
    res.set("Cache-Control", "no-store");
    res.json({ value: secret.value });
  });

  router.put("/:name/secrets/:id", async (req: Request<{ name: string; id: string }>, res: Response) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const { name: secretName, value, description } = req.body;
    const updated = await manager.updateSecret(owner, req.params.id, { name: secretName, value, description });
    if (!updated) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    res.json(updated);
  });

  router.delete("/:name/secrets/:id", async (req: Request<{ name: string; id: string }>, res: Response) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const deleted = await manager.deleteSecret(owner, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    res.json({ deleted: true });
  });

  router.get("/:name/secrets/files", async (req, res) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;
    res.json(await manager.getSecretFiles(owner));
  });

  router.get("/:name/secrets/files/:file/download", (req: Request<{ name: string; file: string }>, res: Response) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const { file } = req.params;
    if (!safeFilename(file)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }
    const filePath = manager.getSecretFilePaths(owner)[file];
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const stat = statSync(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file)}"`);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Type", "application/octet-stream");
    createReadStream(filePath).pipe(res);
  });

  router.post("/:name/secrets/files", async (req, res) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const { filename, content, description } = req.body;
    if (!safeFilename(filename)) {
      res.status(400).json({ error: "Invalid or missing filename" });
      return;
    }
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "Missing file content (base64)" });
      return;
    }

    const data = Buffer.from(content, "base64");
    if (data.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }
    if (data.length > MAX_SECRET_FILE_BYTES) {
      res.status(413).json({ error: "File too large (max 10MB)" });
      return;
    }

    const info = await manager.saveSecretFile(owner, filename, data);
    if (description && typeof description === "string") {
      await manager.updateSecretFileDescription(owner, filename, description);
      info.description = description;
    }
    res.status(201).json(info);
  });

  router.put("/:name/secrets/files/:file/description", async (req: Request<{ name: string; file: string }>, res: Response) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const { file } = req.params;
    if (!safeFilename(file)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }
    const { description } = req.body;
    if (typeof description !== "string") {
      res.status(400).json({ error: "description string required" });
      return;
    }

    const updated = await manager.updateSecretFileDescription(owner, file, description);
    if (!updated) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json({ updated: true });
  });

  router.delete("/:name/secrets/files/:file", async (req: Request<{ name: string; file: string }>, res: Response) => {
    const owner = resolveOwner(req, res);
    if (!owner) return;

    const { file } = req.params;
    if (!safeFilename(file)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const deleted = await manager.deleteSecretFile(owner, file);
    if (!deleted) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.json({ deleted: true });
  });
}
