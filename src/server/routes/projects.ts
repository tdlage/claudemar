import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { Router } from "express";
import { executeSpawn } from "../../executor.js";
import { config } from "../../config.js";
import {
  isValidProjectName,
  listProjects,
  safeProjectPath,
} from "../../session.js";

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => {
  const projects = listProjects();
  res.json(projects.map((name) => ({ name })));
});

projectsRouter.get("/:name", async (req, res) => {
  const { name } = req.params;
  const projectPath = safeProjectPath(name);
  if (!projectPath || !existsSync(projectPath)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  let gitInfo = null;
  try {
    const branch = await executeSpawn("git", ["branch", "--show-current"], projectPath, 5000);
    const log = await executeSpawn("git", ["log", "--oneline", "-20"], projectPath, 5000);
    gitInfo = {
      branch: branch.output.trim(),
      recentCommits: log.output.trim().split("\n").filter(Boolean),
    };
  } catch { /* not a git repo */ }

  res.json({ name, gitInfo });
});

projectsRouter.get("/:name/git-log", async (req, res) => {
  const { name } = req.params;
  const projectPath = safeProjectPath(name);
  if (!projectPath || !existsSync(projectPath)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    const result = await executeSpawn(
      "git",
      ["log", "--pretty=format:%H|%s|%an|%ai", "-50"],
      projectPath,
      10000,
    );
    const commits = result.output.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, message, author, date] = line.split("|");
      return { hash, message, author, date };
    });
    res.json(commits);
  } catch {
    res.json([]);
  }
});

projectsRouter.post("/", async (req, res) => {
  const { url, name: customName } = req.body;
  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  const repoName = customName || url.split("/").pop()?.replace(/\.git$/, "") || "repo";
  if (!isValidProjectName(repoName)) {
    res.status(400).json({ error: "Invalid project name" });
    return;
  }

  const targetPath = safeProjectPath(repoName);
  if (!targetPath) {
    res.status(400).json({ error: "Invalid project name" });
    return;
  }

  if (existsSync(targetPath)) {
    res.status(409).json({ error: "Project already exists" });
    return;
  }

  try {
    const { output, exitCode } = await executeSpawn(
      "git",
      ["clone", url, targetPath],
      config.projectsPath,
      120000,
    );

    if (exitCode !== 0) {
      res.status(500).json({ error: `Clone failed: ${output}` });
      return;
    }

    res.status(201).json({ name: repoName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

projectsRouter.delete("/:name", async (req, res) => {
  const { name } = req.params;
  const projectPath = safeProjectPath(name);
  if (!projectPath || !existsSync(projectPath)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await rm(projectPath, { recursive: true, force: true });
  res.json({ removed: name });
});
