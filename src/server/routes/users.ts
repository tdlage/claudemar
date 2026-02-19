import { Router } from "express";
import { usersManager } from "../../users-manager.js";

export const usersRouter = Router();

usersRouter.get("/", (_req, res) => {
  res.json(usersManager.getAll());
});

usersRouter.post("/", (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }
  const user = usersManager.create(name, email);
  res.status(201).json(user);
});

usersRouter.put("/:id", (req, res) => {
  const updated = usersManager.update(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});

usersRouter.delete("/:id", (req, res) => {
  const deleted = usersManager.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ deleted: true });
});
