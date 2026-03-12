import { Router } from "express";
import { usersManager } from "../../users-manager.js";

export const usersRouter = Router();

usersRouter.get("/", (_req, res) => {
  res.json(usersManager.getAll());
});

usersRouter.post("/", async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }
  const user = await usersManager.create(name, email);
  res.status(201).json(user);
});

usersRouter.put("/:id", async (req, res) => {
  const updated = await usersManager.update(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});

usersRouter.delete("/:id", async (req, res) => {
  const deleted = await usersManager.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ deleted: true });
});
