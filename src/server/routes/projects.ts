import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { rm } from "node:fs/promises";
import archiver from "archiver";
import type { Request, Response } from "express";
import { Router } from "express";
import { safeFilename, listFiles, listDirEntries, asyncHandler } from "../route-utils.js";
import {
  isValidProjectName,
  listProjects,
  safeProjectPath,
} from "../../session.js";
import {
  checkoutBranch,
  cloneRepo,
  createRepoWorktree,
  deleteRepoWorktree,
  discoverRepos,
  fetchRepo,
  getFileDiff,
  getRepoBranches,
  getRepoLog,
  getRepoStatus,
  listWorktrees,
  mergeWorktreeIntoBase,
  pullRepo,
  removeRepo,
  resolveRepoPath,
  resolveWorktree,
  stashRepo,
  setRepoVisibility,
} from "../../repositories.js";
import {
  cancelWorkflowRun,
  dispatchWorkflow,
  getWorkflowRunJobs,
  getWorkflowRunLogs,
  listWorkflowRuns,
  listWorkflows,
  rerunWorkflow,
} from "../../github-actions.js";
import { executionManager } from "../../execution-manager.js";
import { purgeProjectData } from "../../target-cleanup.js";
import { projectSettingsManager } from "../../project-settings.js";
import { isSelectableProjectModel } from "../../models-discovery.js";
import { settingsManager } from "../../settings-manager.js";

export const projectsRouter = Router();

projectsRouter.param("name", (req, res, next) => {
  if (req.ctx?.role === "user" && !req.ctx.projects.includes(req.params.name)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

function resolveProject(req: Request, res: Response): string | null {
  const { name } = req.params;
  const projectPath = safeProjectPath(name);
  if (!projectPath || !existsSync(projectPath)) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  return projectPath;
}

function resolveProjectAndRepo(req: Request, res: Response): { projectPath: string; repoPath: string } | null {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return null;

  const { repo } = req.params;
  const repoPath = resolveRepoPath(projectPath, repo);
  if (!repoPath) {
    res.status(404).json({ error: "Repository not found" });
    return null;
  }

  return { projectPath, repoPath };
}

async function resolveGitTarget(
  req: Request,
  res: Response,
): Promise<{ projectPath: string; repoPath: string; workPath: string; worktreeBranch: string | null } | null> {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return null;

  const worktree = req.query.worktree;
  if (worktree === undefined) {
    return { ...resolved, workPath: resolved.repoPath, worktreeBranch: null };
  }
  if (typeof worktree !== "string" || !worktree) {
    res.status(400).json({ error: "Invalid worktree" });
    return null;
  }

  const found = await resolveWorktree(resolved.repoPath, worktree);
  if (!found) {
    res.status(404).json({ error: "Worktree not found" });
    return null;
  }

  return { ...resolved, workPath: found.path, worktreeBranch: found.branch || null };
}

async function resolveRepoWithRemote(
  req: Request,
  res: Response,
  onMissingRemote: "empty" | "error",
): Promise<{ repoPath: string; remoteUrl: string } | null> {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return null;

  const repos = await discoverRepos(resolved.projectPath);
  const repo = repos.find((r) => resolveRepoPath(resolved.projectPath, r.name) === resolved.repoPath);
  if (!repo?.remoteUrl) {
    if (onMissingRemote === "empty") {
      res.json([]);
    } else {
      res.status(400).json({ error: "No remote URL" });
    }
    return null;
  }

  return { repoPath: resolved.repoPath, remoteUrl: repo.remoteUrl };
}

projectsRouter.get("/", async (req, res) => {
  let projects = listProjects();
  if (req.ctx?.role === "user") {
    const allowed = req.ctx.projects;
    projects = projects.filter((name) => allowed.includes(name));
  }
  const results = await Promise.all(
    projects.map(async (name) => {
      const projectPath = safeProjectPath(name);
      if (!projectPath || !existsSync(projectPath)) {
        return { name, repoCount: 0, hasChanges: false };
      }
      try {
        const repos = await discoverRepos(projectPath, true);
        return {
          name,
          repoCount: repos.length,
          hasChanges: repos.some((r) => r.hasChanges),
        };
      } catch {
        return { name, repoCount: 0, hasChanges: false };
      }
    }),
  );
  res.json(results);
});

projectsRouter.get("/claude-skills", (_req, res) => {
  const skillsDirs = [
    resolve(homedir(), ".claude", "skills"),
    resolve(homedir(), ".claude", "commands"),
  ];

  const skills: { name: string; description: string }[] = [];
  const seen = new Set<string>();

  for (const dir of skillsDirs) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = resolve(dir, entry.name, "SKILL.md");
        if (!existsSync(skillMd)) continue;
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        try {
          const content = readFileSync(skillMd, "utf-8");
          const desc = extractSkillDescription(content);
          skills.push({ name: entry.name, description: desc });
        } catch { }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const name = entry.name.replace(/\.md$/, "");
        if (seen.has(name)) continue;
        seen.add(name);
        try {
          const content = readFileSync(resolve(dir, entry.name), "utf-8");
          const desc = extractSkillDescription(content);
          skills.push({ name, description: desc });
        } catch { }
      }
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  res.json(skills);
});

projectsRouter.get("/:name", asyncHandler(async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const projectName = String(req.params.name);
  const repos = await discoverRepos(projectPath, true);
  const inputFiles = listFiles(inputDir(projectPath));
  res.json({ name: projectName, repos, inputFiles, model: projectSettingsManager.getModel(projectName, settingsManager.getActiveProfile()) });
}));

projectsRouter.put("/:name/model", asyncHandler(async (req, res) => {
  if (req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const { model } = req.body;
  const activeProfile = settingsManager.getActiveProfile();
  if (!isSelectableProjectModel(model, activeProfile)) {
    res.status(400).json({ error: "Invalid model" });
    return;
  }

  projectSettingsManager.setModel(String(req.params.name), model, activeProfile);
  res.json({ model });
}));

projectsRouter.post("/", asyncHandler(async (req, res) => {
  if (req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name required" });
    return;
  }

  if (!isValidProjectName(name)) {
    res.status(400).json({ error: "Invalid project name" });
    return;
  }

  const targetPath = safeProjectPath(name);
  if (!targetPath) {
    res.status(400).json({ error: "Invalid project name" });
    return;
  }

  if (existsSync(targetPath)) {
    res.status(409).json({ error: "Project already exists" });
    return;
  }

  mkdirSync(targetPath, { recursive: true });
  res.status(201).json({ name });
}));

projectsRouter.delete("/:name", asyncHandler(async (req, res) => {
  if (req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const projectName = String(req.params.name);
  await purgeProjectData(projectName);
  await rm(projectPath, { recursive: true, force: true });
  res.json({ removed: projectName });
}));

projectsRouter.get("/:name/repos", asyncHandler(async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const repos = await discoverRepos(projectPath, true);
  res.json(repos);
}));

projectsRouter.post("/:name/repos", asyncHandler(async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const { url, name: repoName } = req.body;
  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  const clonedName = await cloneRepo(projectPath, url, repoName);
  res.status(201).json({ name: clonedName });
}));

projectsRouter.put("/:name/repos/:repo/visibility", (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;
  if (typeof req.body?.visible !== "boolean") {
    res.status(400).json({ error: "visible deve ser booleano" });
    return;
  }
  if (executionManager.getActiveExecutions().some((execution) =>
    execution.cwd === projectPath || execution.cwd.startsWith(projectPath + sep)
    || execution.targetName === String(req.params.name)
    || execution.targetName.startsWith(`__commitpush:${req.params.name}:`))) {
    res.status(409).json({ error: "Aguarde as execuções do projeto terminarem antes de alterar os repositórios." });
    return;
  }
  try {
    setRepoVisibility(projectPath, String(req.params.repo), req.body.visible);
    res.json({ hidden: !req.body.visible });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

projectsRouter.delete("/:name/repos/:repo", async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  try {
    await removeRepo(projectPath, req.params.repo);
    res.json({ removed: req.params.repo });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

projectsRouter.get("/:name/repos/:repo/log", async (req, res) => {
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  try {
    const commits = await getRepoLog(resolved.workPath);
    res.json(commits);
  } catch {
    res.json([]);
  }
});

projectsRouter.get("/:name/repos/:repo/branches", asyncHandler(async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const branches = await getRepoBranches(resolved.repoPath);
  res.json(branches);
}));

projectsRouter.post("/:name/repos/:repo/checkout", asyncHandler(async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const { branch } = req.body;
  if (!branch) {
    res.status(400).json({ error: "Branch required" });
    return;
  }

  const output = await checkoutBranch(resolved.repoPath, branch);
  res.json({ output });
}));

projectsRouter.post("/:name/repos/:repo/pull", asyncHandler(async (req, res) => {
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  const output = await pullRepo(resolved.workPath);
  res.json({ output });
}));

projectsRouter.post("/:name/repos/:repo/stash", asyncHandler(async (req, res) => {
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  const output = await stashRepo(resolved.workPath, req.body?.pop === true);
  res.json({ output });
}));

projectsRouter.post("/:name/repos/:repo/fetch", asyncHandler(async (req, res) => {
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  const output = await fetchRepo(resolved.workPath);
  res.json({ output });
}));

projectsRouter.get("/:name/repos/:repo/status", asyncHandler(async (req, res) => {
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  const files = await getRepoStatus(resolved.workPath);
  res.json(files);
}));

projectsRouter.get("/:name/repos/:repo/diff", asyncHandler(async (req, res) => {
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  const filePath = req.query.path;
  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "Query parameter 'path' is required" });
    return;
  }

  const diff = await getFileDiff(resolved.workPath, filePath);
  res.json(diff);
}));

projectsRouter.get("/:name/repos/:repo/worktrees", asyncHandler(async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const worktrees = await listWorktrees(resolved.repoPath);
  res.json(worktrees);
}));

projectsRouter.post("/:name/repos/:repo/worktrees", asyncHandler(async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const { branch, baseBranch } = req.body ?? {};
  if (!branch || typeof branch !== "string") {
    res.status(400).json({ error: "Branch required" });
    return;
  }

  const worktree = await createRepoWorktree(
    String(req.params.name),
    String(req.params.repo),
    resolved.repoPath,
    branch,
    typeof baseBranch === "string" && baseBranch ? baseBranch : undefined,
  );
  res.status(201).json(worktree);
}));

projectsRouter.delete("/:name/repos/:repo/worktrees", asyncHandler(async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const worktreePath = req.query.path;
  if (!worktreePath || typeof worktreePath !== "string") {
    res.status(400).json({ error: "Query parameter 'path' is required" });
    return;
  }

  const removed = await deleteRepoWorktree(resolved.repoPath, worktreePath, req.query.deleteBranch === "true");
  if (!removed) {
    res.status(404).json({ error: "Worktree not found" });
    return;
  }
  res.json({ removed: true });
}));

projectsRouter.post("/:name/repos/:repo/worktrees/merge", asyncHandler(async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const { worktree, push, remove } = req.body ?? {};
  if (!worktree || typeof worktree !== "string") {
    res.status(400).json({ error: "Worktree required" });
    return;
  }

  const output = await mergeWorktreeIntoBase(resolved.repoPath, worktree, {
    push: push !== false,
    remove: remove !== false,
  });
  res.json({ output });
}));

projectsRouter.get("/:name/claude-agents", (_req, res) => {
  const agentsDir = resolve(homedir(), ".claude", "agents");
  if (!existsSync(agentsDir)) {
    res.json([]);
    return;
  }

  const agents = readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

  res.json(agents);
});

function inputDir(projectPath: string): string {
  return resolve(projectPath, ".input");
}

function outputDir(projectPath: string): string {
  return resolve(projectPath, ".output");
}

function resolveProjectOutputPath(req: Request, res: Response): string | null {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return null;

  const rawWildcard = req.params.wildcard ?? req.params[0];
  const relativePath = Array.isArray(rawWildcard) ? rawWildcard.join("/") : rawWildcard;
  if (!relativePath) {
    res.status(400).json({ error: "Invalid path" });
    return null;
  }

  const segments = relativePath.split("/");
  if (segments.some((s) => !safeFilename(s))) {
    res.status(400).json({ error: "Invalid path segment" });
    return null;
  }

  const base = outputDir(projectPath);
  const filePath = resolve(base, ...segments);
  if (!filePath.startsWith(base + sep)) {
    res.status(400).json({ error: "Invalid path" });
    return null;
  }

  return filePath;
}

projectsRouter.get("/:name/output", (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const base = outputDir(projectPath);
  const subpath = typeof req.query.path === "string" ? req.query.path : "";
  const targetDir = subpath ? resolve(base, subpath) : base;
  if (!targetDir.startsWith(base + sep) && targetDir !== base) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    if (subpath) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }
    res.json([]);
    return;
  }

  res.json(listDirEntries(targetDir));
});

projectsRouter.get("/:name/output-dl/{*wildcard}", (req, res) => {
  const filePath = resolveProjectOutputPath(req, res);
  if (!filePath) return;

  if (!existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(filePath);
  const basename = filePath.split(sep).pop()!;
  if (stat.isDirectory()) {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${basename}.zip"`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "Zip failed" });
    });
    archive.pipe(res);
    archive.directory(filePath, basename);
    archive.finalize();
    return;
  }

  const MIME: Record<string, string> = {
    ".json": "application/json", ".csv": "text/csv", ".txt": "text/plain",
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
    ".xml": "application/xml", ".html": "text/html", ".md": "text/markdown",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  const contentType = MIME[extname(basename).toLowerCase()] || "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(basename)}"`);
  res.setHeader("Content-Length", stat.size);
  createReadStream(filePath).pipe(res);
});

projectsRouter.delete("/:name/output-rm/{*wildcard}", async (req, res) => {
  const filePath = resolveProjectOutputPath(req, res);
  if (!filePath) return;

  if (!existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    await rm(filePath, { recursive: true, force: true });
  } else {
    unlinkSync(filePath);
  }
  res.json({ deleted: true });
});

projectsRouter.get("/:name/input", (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  res.json(listFiles(inputDir(projectPath)));
});

projectsRouter.post("/:name/input", (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const { filename, content } = req.body;
  if (!filename || typeof filename !== "string" || !safeFilename(filename)) {
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
  if (data.length > 10 * 1024 * 1024) {
    res.status(413).json({ error: "File too large (max 10MB)" });
    return;
  }

  const dir = inputDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, filename);
  if (!filePath.startsWith(dir + sep)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  writeFileSync(filePath, data);
  const stat = statSync(filePath);
  res.status(201).json({ name: filename, size: stat.size, mtime: stat.mtime.toISOString() });
});

projectsRouter.get("/:name/input/:file/download", (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const { file } = req.params;
  if (!safeFilename(file)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = resolve(inputDir(projectPath), file);
  if (!filePath.startsWith(inputDir(projectPath) + sep)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(filePath);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file)}"`);
  res.setHeader("Content-Length", stat.size);
  createReadStream(filePath).pipe(res);
});

projectsRouter.delete("/:name/input/:file", (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const { file } = req.params;
  if (!safeFilename(file)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = resolve(inputDir(projectPath), file);
  if (!filePath.startsWith(inputDir(projectPath) + sep)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  unlinkSync(filePath);
  res.json({ deleted: true });
});

function extractSkillDescription(content: string): string {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return "";
  const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
  return descMatch ? descMatch[1].trim() : "";
}

projectsRouter.post("/:name/repos/:repo/commit-push", asyncHandler(async (req, res) => {
  if (executionManager.isDraining()) {
    res.status(409).json({ error: "Serviço em reinício para atualização — tente novamente em instantes" });
    return;
  }
  const resolved = await resolveGitTarget(req, res);
  if (!resolved) return;

  const worktreeSuffix = resolved.workPath !== resolved.repoPath
    ? `:wt-${resolved.worktreeBranch || "detached"}`
    : "";
  const targetName = `__commitpush:${req.params.name}:${req.params.repo}${worktreeSuffix}`;
  const trackerItems: string[] = req.body?.trackerItems || [];

  let prompt = "Analyze all uncommitted changes (staged and unstaged), write a clear and concise commit message following conventional commits style, stage all changes, commit, and push to origin. If the current branch has no upstream, push with -u origin <branch>. If there are merge conflicts, resolve them. Show the final commit message and push result.";

  if (trackerItems.length > 0) {
    prompt += `\n\nIMPORTANT: Include these tracker item references in the commit message footer as "Refs: ${trackerItems.join(", ")}".`;
  }

  const username = req.ctx?.role === "admin" ? "admin" : req.ctx?.name;
  const id = executionManager.startExecution({
    source: "web",
    targetType: "project",
    targetName,
    prompt,
    cwd: resolved.workPath,
    noResume: true,
    username,
    autoApprove: true,
  });

  res.status(201).json({ id });
}));

// ── CI / GitHub Actions ──

projectsRouter.get("/:name/repos/:repo/ci/workflows", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "empty");
  if (!repo) return;

  const workflows = await listWorkflows(repo.repoPath, repo.remoteUrl);
  res.json(workflows);
}));

projectsRouter.get("/:name/repos/:repo/ci/runs", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "empty");
  if (!repo) return;

  const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;
  const workflowId = typeof req.query.workflowId === "string" ? Number(req.query.workflowId) : undefined;
  const runs = await listWorkflowRuns(repo.repoPath, repo.remoteUrl, branch, workflowId);
  res.json(runs);
}));

projectsRouter.get("/:name/repos/:repo/ci/runs/:runId/jobs", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "error");
  if (!repo) return;

  const jobs = await getWorkflowRunJobs(repo.repoPath, repo.remoteUrl, Number(req.params.runId));
  res.json(jobs);
}));

projectsRouter.get("/:name/repos/:repo/ci/runs/:runId/logs", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "error");
  if (!repo) return;

  const jobName = typeof req.query.job === "string" ? req.query.job : undefined;
  const logs = await getWorkflowRunLogs(repo.repoPath, repo.remoteUrl, Number(req.params.runId), jobName);
  res.json({ logs });
}));

projectsRouter.post("/:name/repos/:repo/ci/dispatch", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "error");
  if (!repo) return;

  const { workflowId, ref, inputs } = req.body;
  if (!workflowId || !ref) {
    res.status(400).json({ error: "workflowId and ref are required" });
    return;
  }

  await dispatchWorkflow(repo.repoPath, repo.remoteUrl, String(workflowId), ref, inputs);
  res.json({ dispatched: true });
}));

projectsRouter.post("/:name/repos/:repo/ci/runs/:runId/rerun", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "error");
  if (!repo) return;

  const failedOnly = req.body?.failedOnly === true;
  await rerunWorkflow(repo.repoPath, repo.remoteUrl, Number(req.params.runId), failedOnly);
  res.json({ rerun: true });
}));

projectsRouter.post("/:name/repos/:repo/ci/runs/:runId/cancel", asyncHandler(async (req, res) => {
  const repo = await resolveRepoWithRemote(req, res, "error");
  if (!repo) return;

  await cancelWorkflowRun(repo.repoPath, repo.remoteUrl, Number(req.params.runId));
  res.json({ cancelled: true });
}));
