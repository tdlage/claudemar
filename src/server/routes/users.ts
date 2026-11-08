import { Router } from "express";
import { DEFAULT_PROJECT_TABS, usersManager, type User } from "../../users-manager.js";
import { pruneDriveOwnerTargets, purgeDriveOwner } from "../../google-drive/service.js";
import type { DriveTarget } from "../../google-drive/store.js";

export const usersRouter = Router();

function driveTargetsOf(user: User): DriveTarget[] {
  const projects = user.projects.filter((project) => (user.projectTabs[project] ?? DEFAULT_PROJECT_TABS).includes("input"));
  return [
    ...user.agents.map((name): DriveTarget => ({ type: "agent", name })),
    ...projects.map((name): DriveTarget => ({ type: "project", name })),
  ];
}

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
  if (req.body?.agents !== undefined || req.body?.projects !== undefined || req.body?.projectTabs !== undefined) {
    await pruneDriveOwnerTargets(updated.id, driveTargetsOf(updated));
  }
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
