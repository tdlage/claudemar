import { Router } from "express";
import { requireAdmin } from "../middleware.js";
import { trackerManager } from "../../tracker-manager.js";
import { usersManager } from "../../users-manager.js";
import { executionManager } from "../../execution-manager.js";
import { commandQueue } from "../../queue.js";
import { safeProjectPath } from "../../session.js";
import { registerPlanExecution } from "../../tracker-execution-bridge.js";

export const trackerRouter = Router();

function getAuthor(req: Express.Request): { id: string; name: string } {
  const ctx = req.ctx!;
  if (ctx.role === "admin") return { id: "admin", name: "Admin" };
  return { id: ctx.userId, name: ctx.name };
}

function hasTrackerAccess(req: Express.Request, projectId: string): boolean {
  const ctx = req.ctx!;
  if (ctx.role === "admin") return true;
  return ctx.trackerProjects.includes(projectId);
}

// ── Projects ──

trackerRouter.get("/projects", async (req, res) => {
  let projects = await trackerManager.getProjects();
  if (req.ctx?.role === "user") {
    const allowed = new Set(req.ctx.trackerProjects);
    projects = projects.filter((p) => allowed.has(p.id));
  }
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

trackerRouter.get("/projects/:projectId/members", (req, res) => {
  const projectId = req.params.projectId;
  if (!hasTrackerAccess(req, projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const members: Array<{ id: string; name: string }> = [{ id: "admin", name: "Admin" }];
  for (const u of usersManager.getAll()) {
    if (u.trackerProjects.includes(projectId)) {
      members.push({ id: u.id, name: u.name });
    }
  }
  res.json(members);
});

// ── Cycles ──

trackerRouter.get("/projects/:projectId/cycles", async (req, res) => {
  const cycles = await trackerManager.getCyclesByProject(req.params.projectId);
  res.json(cycles);
});

trackerRouter.get("/projects/:projectId/cycle-stats", async (req, res) => {
  const stats = await trackerManager.getCycleItemStats(req.params.projectId);
  const result: Record<string, { total: number; byColumn: Record<string, number> }> = {};
  for (const [cycleId, entry] of stats) {
    result[cycleId] = { total: entry.total, byColumn: Object.fromEntries(entry.byColumn) };
  }
  res.json(result);
});

trackerRouter.get("/projects/:projectId/board-items", async (req, res) => {
  const projectId = req.params.projectId as string;
  if (!hasTrackerAccess(req, projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const cyclesParam = req.query.cycles as string | undefined;
  const cycleIds = cyclesParam ? cyclesParam.split(",").filter(Boolean) : undefined;
  const items = await trackerManager.getItemsByProject(projectId, cycleIds);
  res.json(items);
});

trackerRouter.post("/cycles", async (req, res) => {
  const { projectId, name, type } = req.body;
  if (!projectId || !name) { res.status(400).json({ error: "projectId and name required" }); return; }
  if (type && !["features", "bugs"].includes(type)) { res.status(400).json({ error: "type must be 'features' or 'bugs'" }); return; }
  if (!hasTrackerAccess(req, projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const author = getAuthor(req);
  const cycle = await trackerManager.createCycle({ projectId, name, type, createdBy: author.id });
  res.status(201).json(cycle);
});

trackerRouter.put("/cycles/:id", async (req, res) => {
  const cycle = await trackerManager.getCycle(req.params.id);
  if (!cycle) { res.status(404).json({ error: "Cycle not found" }); return; }
  if (!hasTrackerAccess(req, cycle.projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (req.body.type && !["features", "bugs"].includes(req.body.type)) { res.status(400).json({ error: "type must be 'features' or 'bugs'" }); return; }
  const updated = await trackerManager.updateCycle(req.params.id as string, req.body);
  res.json(updated);
});

trackerRouter.delete("/cycles/:id", async (req, res) => {
  const cycle = await trackerManager.getCycle(req.params.id);
  if (!cycle) { res.status(404).json({ error: "Cycle not found" }); return; }
  if (!hasTrackerAccess(req, cycle.projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const deleted = await trackerManager.deleteCycle(req.params.id as string);
  if (!deleted) { res.status(404).json({ error: "Cycle not found" }); return; }
  res.json({ deleted: true });
});

// ── Items ──

trackerRouter.get("/cycles/:cycleId/items", async (req, res) => {
  const items = await trackerManager.getItemsByCycle(req.params.cycleId);
  res.json(items);
});

trackerRouter.post("/items", async (req, res) => {
  const { cycleId, title, type, description, appetite, priority, inScope, outOfScope, assignees, tags, columnId } = req.body;
  if (!cycleId || !title) { res.status(400).json({ error: "cycleId and title required" }); return; }
  if (type && !["feature", "bug"].includes(type)) { res.status(400).json({ error: "type must be 'feature' or 'bug'" }); return; }
  const cycle = await trackerManager.getCycle(cycleId);
  if (!cycle || cycle.columns.length === 0) {
    res.status(400).json({ error: "Cycle not found or has no columns" });
    return;
  }
  if (!hasTrackerAccess(req, cycle.projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const resolvedColumnId = columnId || [...cycle.columns].sort((a, b) => a.position - b.position)[0].id;
  const author = getAuthor(req);
  const item = await trackerManager.createItem({
    cycleId, title, type, description, appetite: appetite ? Number(appetite) : undefined,
    priority, inScope, outOfScope, columnId: resolvedColumnId, assignees, tags, createdBy: author.id,
  });
  res.status(201).json(item);
});

trackerRouter.put("/items/:id", async (req, res) => {
  const item = await trackerManager.getItem(req.params.id);
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  if (req.body.type && !["feature", "bug"].includes(req.body.type)) { res.status(400).json({ error: "type must be 'feature' or 'bug'" }); return; }
  const updated = await trackerManager.updateItem(req.params.id, req.body);
  res.json(updated);
});

trackerRouter.patch("/items/:id/move", async (req, res) => {
  const { columnId, position } = req.body;
  if (!columnId) { res.status(400).json({ error: "columnId required" }); return; }
  const item = await trackerManager.moveItem(req.params.id, columnId, position ?? 0);
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(item);
});

trackerRouter.delete("/items/:id", async (req, res) => {
  const item = await trackerManager.getItem(req.params.id);
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  const cycle = await trackerManager.getCycle(item.cycleId);
  if (cycle && !hasTrackerAccess(req, cycle.projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const deleted = await trackerManager.deleteItem(req.params.id as string);
  if (!deleted) { res.status(404).json({ error: "Item not found" }); return; }
  res.json({ deleted: true });
});

// ── Item Search ──

trackerRouter.get("/items/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) { res.json([]); return; }
  const results = await trackerManager.searchItems(q);
  res.json(results);
});

// ── Comments ──

trackerRouter.get("/comments/:targetType/:targetId", async (req, res) => {
  const { targetType, targetId } = req.params;
  if (targetType !== "item") { res.status(400).json({ error: "targetType must be item" }); return; }
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

// ── Test Cases ──

trackerRouter.get("/test-cases/:id/runs", async (req, res) => {
  const runs = await trackerManager.getTestRuns(req.params.id as string);
  res.json(runs);
});

trackerRouter.get("/test-cases/:targetType/:targetId", async (req, res) => {
  const { targetType, targetId } = req.params;
  if (targetType !== "item") { res.status(400).json({ error: "targetType must be item" }); return; }
  const cases = await trackerManager.getTestCases(targetType as string, targetId as string);
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
  const tc = await trackerManager.updateTestCase(req.params.id as string, req.body);
  if (!tc) { res.status(404).json({ error: "Test case not found" }); return; }
  res.json(tc);
});

trackerRouter.delete("/test-cases/:id", async (req, res) => {
  const deleted = await trackerManager.deleteTestCase(req.params.id as string);
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

// ── Item Plans ──

async function resolveItemProjectId(itemId: string): Promise<string | null> {
  const item = await trackerManager.getItem(itemId);
  if (!item) return null;
  const cycle = await trackerManager.getCycle(item.cycleId);
  return cycle?.projectId ?? null;
}

trackerRouter.get("/items/:itemId/plan", async (req, res) => {
  const projectId = await resolveItemProjectId(req.params.itemId as string);
  if (!projectId) { res.status(404).json({ error: "Item not found" }); return; }
  if (!hasTrackerAccess(req, projectId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const plan = await trackerManager.getItemPlan(req.params.itemId as string);
  res.json(plan);
});

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
}

function generatePlanPrompt(item: { title: string; description: string; inScope: string; outOfScope: string }, itemCode: string): string {
  let prompt = `Planeje a implementacao do item ${itemCode}: ${item.title}\n\n`;
  if (item.description) {
    prompt += `Descricao:\n${stripMarkdown(item.description)}\n\n`;
  }
  if (item.inScope) {
    prompt += `In Scope:\n${item.inScope}\n\n`;
  }
  if (item.outOfScope) {
    prompt += `Out of Scope:\n${item.outOfScope}\n\n`;
  }
  return prompt;
}

trackerRouter.post("/items/:itemId/send-to-project", requireAdmin, async (req, res) => {
  const { targetProject, prompt, planMode = true } = req.body;
  if (!targetProject || !prompt) { res.status(400).json({ error: "targetProject and prompt required" }); return; }

  const projectPath = safeProjectPath(targetProject);
  if (!projectPath) { res.status(400).json({ error: "Project not found" }); return; }

  const itemCode = await trackerManager.getItemCode(req.params.itemId as string);
  if (!itemCode) { res.status(404).json({ error: "Item not found" }); return; }

  let execId: string;

  if (planMode) {
    const author = getAuthor(req);
    const plan = await trackerManager.createItemPlan({
      itemId: req.params.itemId as string,
      targetProject,
      promptSent: prompt,
      createdBy: author.id,
    });

    try {
      execId = executionManager.startExecution({
        source: "web",
        targetType: "project",
        targetName: targetProject,
        prompt,
        cwd: projectPath,
        planMode: true,
        noResume: true,
        username: "admin",
      });
    } catch (err) {
      await trackerManager.updateItemPlan(plan.id, { status: "error" });
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start execution" });
      return;
    }

    await trackerManager.updateItemPlan(plan.id, { lastExecutionId: execId });
    registerPlanExecution(execId, plan.id, itemCode, "plan");

    res.status(201).json({ planId: plan.id, executionId: execId });
  } else {
    try {
      execId = executionManager.startExecution({
        source: "web",
        targetType: "project",
        targetName: targetProject,
        prompt,
        cwd: projectPath,
        planMode: false,
        noResume: true,
        username: "admin",
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start execution" });
      return;
    }

    res.status(201).json({ executionId: execId });
  }
});

trackerRouter.post("/items/:itemId/execute-plan", requireAdmin, async (req, res) => {
  const plan = await trackerManager.getItemPlan(req.params.itemId as string);
  if (!plan) { res.status(404).json({ error: "No plan found for this item" }); return; }
  if (plan.status !== "planned") { res.status(400).json({ error: `Plan status is '${plan.status}', expected 'planned'` }); return; }
  if (!plan.sessionId) { res.status(400).json({ error: "No session ID available" }); return; }

  const projectPath = safeProjectPath(plan.targetProject);
  if (!projectPath) { res.status(400).json({ error: "Project not found" }); return; }

  let execId: string;
  try {
    execId = executionManager.startExecution({
      source: "web",
      targetType: "project",
      targetName: plan.targetProject,
      prompt: "Execute o plano em sua totalidade",
      cwd: projectPath,
      resumeSessionId: plan.sessionId,
      planMode: false,
      username: "admin",
    });
  } catch (err) {
    await trackerManager.updateItemPlan(plan.id, { status: "error" });
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start execution" });
    return;
  }

  registerPlanExecution(execId, plan.id, "", "execute");

  await commandQueue.enqueue({
    targetType: "project",
    targetName: plan.targetProject,
    prompt: "Valide e corrija os problemas encontrados",
    source: "web",
    cwd: projectPath,
    resumeSessionId: plan.sessionId,
    agentName: "pragmatic-code-reviewer",
    username: "admin",
  });

  await trackerManager.updateItemPlan(plan.id, { status: "executing", lastExecutionId: execId });

  res.json({ executionId: execId });
});

trackerRouter.post("/items/:itemId/review-plan", requireAdmin, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) { res.status(400).json({ error: "prompt required" }); return; }

  const plan = await trackerManager.getItemPlan(req.params.itemId as string);
  if (!plan) { res.status(404).json({ error: "No plan found for this item" }); return; }
  if (!plan.sessionId) { res.status(400).json({ error: "No session ID available" }); return; }

  const projectPath = safeProjectPath(plan.targetProject);
  if (!projectPath) { res.status(400).json({ error: "Project not found" }); return; }

  let execId: string;
  try {
    execId = executionManager.startExecution({
      source: "web",
      targetType: "project",
      targetName: plan.targetProject,
      prompt,
      cwd: projectPath,
      resumeSessionId: plan.sessionId,
      planMode: true,
      username: "admin",
    });
  } catch (err) {
    await trackerManager.updateItemPlan(plan.id, { status: "error" });
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start execution" });
    return;
  }

  registerPlanExecution(execId, plan.id, "", "review");
  await trackerManager.updateItemPlan(plan.id, { status: "reviewing", lastExecutionId: execId });

  res.json({ executionId: execId });
});

trackerRouter.get("/items/:itemId/generate-prompt", requireAdmin, async (req, res) => {
  const item = await trackerManager.getItem(req.params.itemId as string);
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  const itemCode = await trackerManager.getItemCode(req.params.itemId as string) ?? `ITEM-${item.seqNumber}`;
  res.json({ prompt: generatePlanPrompt(item, itemCode) });
});
