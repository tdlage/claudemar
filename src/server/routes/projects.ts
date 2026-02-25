import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { rm } from "node:fs/promises";
import type { Request, Response } from "express";
import { Router } from "express";
import { safeFilename, listFiles } from "../route-utils.js";
import {
  isValidProjectName,
  listProjects,
  safeProjectPath,
} from "../../session.js";
import {
  checkoutBranch,
  cloneRepo,
  discoverRepos,
  fetchRepo,
  getFileDiff,
  getRepoBranches,
  getRepoLog,
  getRepoStatus,
  pullRepo,
  removeRepo,
  resolveRepoPath,
  stashRepo,
} from "../../repositories.js";
import { executionManager } from "../../execution-manager.js";

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
        const repos = await discoverRepos(projectPath);
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

projectsRouter.get("/:name", async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  try {
    const repos = await discoverRepos(projectPath);
    const inputFiles = listFiles(inputDir(projectPath));
    res.json({ name: req.params.name, repos, inputFiles });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/", async (req, res) => {
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

  try {
    mkdirSync(targetPath, { recursive: true });
    res.status(201).json({ name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.delete("/:name", async (req, res) => {
  if (req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  await rm(projectPath, { recursive: true, force: true });
  res.json({ removed: req.params.name });
});

projectsRouter.get("/:name/repos", async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  try {
    const repos = await discoverRepos(projectPath);
    res.json(repos);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/:name/repos", async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  const { url, name: repoName } = req.body;
  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  try {
    const clonedName = await cloneRepo(projectPath, url, repoName);
    res.status(201).json({ name: clonedName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  try {
    const commits = await getRepoLog(resolved.repoPath);
    res.json(commits);
  } catch {
    res.json([]);
  }
});

projectsRouter.get("/:name/repos/:repo/branches", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  try {
    const branches = await getRepoBranches(resolved.repoPath);
    res.json(branches);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/:name/repos/:repo/checkout", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const { branch } = req.body;
  if (!branch) {
    res.status(400).json({ error: "Branch required" });
    return;
  }

  try {
    const output = await checkoutBranch(resolved.repoPath, branch);
    res.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/:name/repos/:repo/pull", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  try {
    const output = await pullRepo(resolved.repoPath);
    res.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/:name/repos/:repo/stash", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  try {
    const output = await stashRepo(resolved.repoPath, req.body?.pop === true);
    res.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/:name/repos/:repo/fetch", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  try {
    const output = await fetchRepo(resolved.repoPath);
    res.json({ output });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.get("/:name/repos/:repo/status", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  try {
    const files = await getRepoStatus(resolved.repoPath);
    res.json(files);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.get("/:name/repos/:repo/diff", async (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const filePath = req.query.path;
  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "Query parameter 'path' is required" });
    return;
  }

  try {
    const diff = await getFileDiff(resolved.repoPath, filePath);
    res.json(diff);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

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

projectsRouter.post("/:name/repos/:repo/commit-push", (req, res) => {
  const resolved = resolveProjectAndRepo(req, res);
  if (!resolved) return;

  const targetName = `__commitpush:${req.params.name}:${req.params.repo}`;

  const id = executionManager.startExecution({
    source: "web",
    targetType: "project",
    targetName,
    prompt: "Analyze all uncommitted changes (staged and unstaged), write a clear and concise commit message following conventional commits style, stage all changes, commit, and push to origin. If there are merge conflicts, resolve them. Show the final commit message and push result.",
    cwd: resolved.repoPath,
    noResume: true,
    model: "claude-sonnet-4-6",
  });

  res.status(201).json({ id });
});
