import { Router } from "express";

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
  });
});
