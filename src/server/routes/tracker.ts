import { Router } from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { requireAdmin } from "../middleware.js";
import { trackerManager } from "../../tracker-manager.js";
import { config } from "../../config.js";

export const trackerRouter = Router();

function getAuthor(req: Express.Request): { id: string; name: string } {
  const ctx = req.ctx!;
  if (ctx.role === "admin") return { id: "admin", name: "Admin" };
  return { id: ctx.userId, name: ctx.name };
}

// ── Projects ──

trackerRouter.get("/projects", async (_req, res) => {
  const projects = await trackerManager.getProjects();
  res.json(projects);
});

trackerRouter.post("/projects", requireAdmin, async (req, res) => {
  const { name, code, description } = req.body;
  if (!name || !code) { res.status(400).json({ error: "name and code required" }); return; }
  const cleanCode = code.replace(/[^A-Za-z0-9]/g, "").substring(0, 10).toUpperCase();
  if (cleanCode.length < 2) { res.status(400).json({ error: "code must be at least 2 characters" }); return; }
  const author = getAuthor(req);
  try {
    const project = await trackerManager.createProject({ name, code: cleanCode, description, createdBy: author.id });
    res.status(201).json(project);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Duplicate")) {
      res.status(409).json({ error: "Code already in use" });
      return;
    }
    throw err;
  }
});

trackerRouter.put("/projects/:id", requireAdmin, async (req, res) => {
  const project = await trackerManager.updateProject(req.params.id as string, req.body);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(project);
});

trackerRouter.delete("/projects/:id", requireAdmin, async (req, res) => {
  const deleted = await trackerManager.deleteProject(req.params.id as string);
  if (!deleted) { res.status(404).json({ error: "Project not found" }); return; }
  res.json({ deleted: true });
});

// ── Cycles ──

trackerRouter.get("/projects/:projectId/cycles", async (req, res) => {
  const cycles = await trackerManager.getCyclesByProject(req.params.projectId);
  res.json(cycles);
});

trackerRouter.post("/cycles", requireAdmin, async (req, res) => {
  const { projectId, name } = req.body;
  if (!projectId || !name) { res.status(400).json({ error: "projectId and name required" }); return; }
  const author = getAuthor(req);
  const cycle = await trackerManager.createCycle({ projectId, name, createdBy: author.id });
  res.status(201).json(cycle);
});

trackerRouter.put("/cycles/:id", requireAdmin, async (req, res) => {
  const cycle = await trackerManager.updateCycle(req.params.id as string, req.body);
  if (!cycle) { res.status(404).json({ error: "Cycle not found" }); return; }
  res.json(cycle);
});

trackerRouter.delete("/cycles/:id", requireAdmin, async (req, res) => {
  const deleted = await trackerManager.deleteCycle(req.params.id as string);
  if (!deleted) { res.status(404).json({ error: "Cycle not found" }); return; }
  res.json({ deleted: true });
});

// ── Bets ──

trackerRouter.get("/cycles/:cycleId/bets", async (req, res) => {
  const bets = await trackerManager.getBetsByCycle(req.params.cycleId);
  res.json(bets);
});

trackerRouter.post("/bets", requireAdmin, async (req, res) => {
  const { cycleId, title, description, appetite, assignees, tags, columnId } = req.body;
  if (!cycleId || !title) { res.status(400).json({ error: "cycleId and title required" }); return; }
  let resolvedColumnId = columnId;
  if (!resolvedColumnId) {
    const cycle = await trackerManager.getCycle(cycleId);
    if (!cycle || cycle.columns.length === 0) {
      res.status(400).json({ error: "Cycle not found or has no columns" });
      return;
    }
    resolvedColumnId = [...cycle.columns].sort((a, b) => a.position - b.position)[0].id;
  }
  const author = getAuthor(req);
  const bet = await trackerManager.createBet({
    cycleId, title, description, appetite, columnId: resolvedColumnId,
    assignees, tags, createdBy: author.id,
  });
  res.status(201).json(bet);
});

trackerRouter.put("/bets/:id", async (req, res) => {
  const bet = await trackerManager.getBet(req.params.id);
  if (!bet) { res.status(404).json({ error: "Bet not found" }); return; }
  const updated = await trackerManager.updateBet(req.params.id, req.body);
  res.json(updated);
});

trackerRouter.patch("/bets/:id/move", async (req, res) => {
  const { columnId, position } = req.body;
  if (!columnId) { res.status(400).json({ error: "columnId required" }); return; }
  const bet = await trackerManager.moveBet(req.params.id, columnId, position ?? 0);
  if (!bet) { res.status(404).json({ error: "Bet not found" }); return; }
  res.json(bet);
});

trackerRouter.delete("/bets/:id", requireAdmin, async (req, res) => {
  const deleted = await trackerManager.deleteBet(req.params.id as string);
  if (!deleted) { res.status(404).json({ error: "Bet not found" }); return; }
  res.json({ deleted: true });
});

// ── Bet Search ──

trackerRouter.get("/bets/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) { res.json([]); return; }
  const results = await trackerManager.searchBets(q);
  res.json(results);
});

// ── Comments ──

trackerRouter.get("/comments/:targetType/:targetId", async (req, res) => {
  const { targetType, targetId } = req.params;
  if (targetType !== "bet") { res.status(400).json({ error: "targetType must be bet" }); return; }
  const comments = await trackerManager.getComments(targetType, targetId);
  res.json(comments);
});

trackerRouter.post("/comments", async (req, res) => {
  const { targetType, targetId, content, attachments } = req.body;
  if (!targetType || !targetId || !content) {
    res.status(400).json({ error: "targetType, targetId, content required" });
    return;
  }
  const author = getAuthor(req);
  const comment = await trackerManager.addComment({
    targetType, targetId, authorId: author.id, authorName: author.name, content, attachments,
  });
  res.status(201).json(comment);
});

trackerRouter.delete("/comments/:id", async (req, res) => {
  const deleted = await trackerManager.deleteComment(req.params.id);
  if (!deleted) { res.status(404).json({ error: "Comment not found" }); return; }
  res.json({ deleted: true });
});

// ── Uploads ──

trackerRouter.get("/uploads/:filename", (req, res) => {
  const uploadsDir = resolve(config.dataPath, "tracker-uploads");
  const filePath = resolve(uploadsDir, req.params.filename);
  if (!filePath.startsWith(uploadsDir) || !existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.sendFile(filePath);
});

// ── Test Cases ──

trackerRouter.get("/test-cases/:targetType/:targetId", async (req, res) => {
  const { targetType, targetId } = req.params;
  if (targetType !== "bet") { res.status(400).json({ error: "targetType must be bet" }); return; }
  const cases = await trackerManager.getTestCases(targetType, targetId);
  res.json(cases);
});

trackerRouter.post("/test-cases", async (req, res) => {
  const { targetType, targetId, title, description, preconditions, steps, expectedResult, priority } = req.body;
  if (!targetType || !targetId || !title) {
    res.status(400).json({ error: "targetType, targetId, title required" });
    return;
  }
  const author = getAuthor(req);
  const tc = await trackerManager.createTestCase({
    targetType, targetId, title, description, preconditions, steps, expectedResult, priority, createdBy: author.id,
  });
  res.status(201).json(tc);
});

trackerRouter.put("/test-cases/:id", async (req, res) => {
  const tc = await trackerManager.updateTestCase(req.params.id, req.body);
  if (!tc) { res.status(404).json({ error: "Test case not found" }); return; }
  res.json(tc);
});

trackerRouter.delete("/test-cases/:id", async (req, res) => {
  const deleted = await trackerManager.deleteTestCase(req.params.id);
  if (!deleted) { res.status(404).json({ error: "Test case not found" }); return; }
  res.json({ deleted: true });
});

trackerRouter.patch("/test-cases/reorder", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids array required" }); return; }
  await trackerManager.reorderTestCases(ids);
  res.json({ reordered: true });
});

// ── Test Runs ──

trackerRouter.get("/test-cases/:id/runs", async (req, res) => {
  const runs = await trackerManager.getTestRuns(req.params.id);
  res.json(runs);
});

trackerRouter.post("/test-runs", async (req, res) => {
  const { testCaseId, status, notes, durationSeconds, attachments } = req.body;
  if (!testCaseId || !status) { res.status(400).json({ error: "testCaseId and status required" }); return; }
  const author = getAuthor(req);
  const run = await trackerManager.createTestRun({
    testCaseId, status, notes, executedBy: author.id,
    executedByName: author.name, durationSeconds, attachments,
  });
  res.status(201).json(run);
});

trackerRouter.put("/test-runs/:id", async (req, res) => {
  const run = await trackerManager.updateTestRun(req.params.id, req.body);
  if (!run) { res.status(404).json({ error: "Test run not found" }); return; }
  res.json(run);
});

trackerRouter.delete("/test-runs/:id", async (req, res) => {
  const deleted = await trackerManager.deleteTestRun(req.params.id);
  if (!deleted) { res.status(404).json({ error: "Test run not found" }); return; }
  res.json({ deleted: true });
});

trackerRouter.post("/test-runs/:id/attachments", async (req, res) => {
  const { base64, filename, mimeType } = req.body;
  if (!base64 || !filename || !mimeType) {
    res.status(400).json({ error: "base64, filename, mimeType required" });
    return;
  }
  const author = getAuthor(req);
  const attachment = await trackerManager.uploadTestRunAttachment(req.params.id, base64, filename, mimeType, author.id);
  res.status(201).json(attachment);
});

// ── Test Run Comments ──

trackerRouter.get("/test-runs/:id/comments", async (req, res) => {
  const comments = await trackerManager.getTestRunComments(req.params.id);
  res.json(comments);
});

trackerRouter.post("/test-run-comments", async (req, res) => {
  const { testRunId, content, attachments } = req.body;
  if (!testRunId || !content) { res.status(400).json({ error: "testRunId and content required" }); return; }
  const author = getAuthor(req);
  const comment = await trackerManager.addTestRunComment({
    testRunId, authorId: author.id, authorName: author.name, content, attachments,
  });
  res.status(201).json(comment);
});
