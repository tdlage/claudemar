import { Router } from "express";
import { usersManager } from "../../users-manager.js";
import { pruneDriveOwnerAgents, purgeDriveOwner } from "../../google-drive/service.js";

export const usersRouter = Router();

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function nameError(name: unknown, userId?: string): { status: 400 | 409; error: string } | null {
  if (typeof name !== "string") return null;
  if (normalizedName(name) === "admin") return { status: 400, error: "The name \"admin\" is reserved for the administrator" };
  const taken = usersManager.getAll().some((u) => u.id !== userId && normalizedName(u.name) === normalizedName(name));
  return taken ? { status: 409, error: "A user with this name already exists" } : null;
}

usersRouter.get("/", (_req, res) => {
  res.json(usersManager.getAll());
});

usersRouter.post("/", async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }
  const invalidName = nameError(name);
  if (invalidName) {
    res.status(invalidName.status).json({ error: invalidName.error });
    return;
  }
  const user = await usersManager.create(name, email);
  res.status(201).json(user);
});

usersRouter.put("/:id", async (req, res) => {
  const invalidName = nameError(req.body?.name, req.params.id);
  if (invalidName) {
    res.status(invalidName.status).json({ error: invalidName.error });
    return;
  }
  const updated = await usersManager.update(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (req.body?.agents !== undefined) await pruneDriveOwnerAgents(updated.id, updated.agents);
  res.json(updated);
});

usersRouter.delete("/:id", async (req, res) => {
  const deleted = await usersManager.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await purgeDriveOwner(req.params.id);
  res.json({ deleted: true });
});
