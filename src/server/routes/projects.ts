import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { Request, Response } from "express";
import { Router } from "express";
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

projectsRouter.get("/", async (_req, res) => {
  const projects = listProjects();
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

projectsRouter.get("/:name", async (req, res) => {
  const projectPath = resolveProject(req, res);
  if (!projectPath) return;

  try {
    const repos = await discoverRepos(projectPath);
    res.json({ name: req.params.name, repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.post("/", async (req, res) => {
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
  });

  res.status(201).json({ id });
});
