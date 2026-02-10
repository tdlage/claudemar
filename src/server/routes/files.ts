import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, sep, relative, extname } from "node:path";
import { Router } from "express";
import { config } from "../../config.js";
import { getAgentPaths, isValidAgentName } from "../../agents/manager.js";
import { safeProjectPath } from "../../session.js";

export const filesRouter = Router();

function resolveBase(base: string): string | null {
  if (base === "orchestrator") return config.orchestratorPath;

  const [type, name] = base.split(":");
  if (!name) return null;

  if (type === "agent") {
    if (!isValidAgentName(name)) return null;
    const paths = getAgentPaths(name);
    return paths?.root ?? null;
  }

  if (type === "project") {
    return safeProjectPath(name);
  }

  return null;
}

function safePath(basePath: string, filePath: string): string | null {
  const resolved = resolve(basePath, filePath);
  if (!resolved.startsWith(basePath + sep) && resolved !== basePath) return null;
  return resolved;
}

filesRouter.get("/", (req, res) => {
  const base = req.query.base as string;
  const filePath = (req.query.path as string) || "";

  if (!base) {
    res.status(400).json({ error: "base query param required" });
    return;
  }

  const basePath = resolveBase(base);
  if (!basePath || !existsSync(basePath)) {
    res.status(404).json({ error: "Base not found" });
    return;
  }

  const resolved = safePath(basePath, filePath);
  if (!resolved) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(resolved)) {
    res.status(404).json({ error: "Path not found" });
    return;
  }

  const stat = statSync(resolved);

  if (stat.isDirectory()) {
    const entries = readdirSync(resolved, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") || e.name === ".claude")
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" as const : "file" as const,
        path: relative(basePath, resolve(resolved, e.name)),
      }));
    res.json({ type: "directory", entries });
    return;
  }

  if (stat.size > 2 * 1024 * 1024) {
    res.status(413).json({ error: "File too large (max 2MB)" });
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".tar", ".gz"]);

  if (binaryExtensions.has(ext)) {
    res.json({ type: "file", binary: true, size: stat.size });
    return;
  }

  const content = readFileSync(resolved, "utf-8");
  res.json({ type: "file", content, size: stat.size });
});

filesRouter.put("/", (req, res) => {
  const base = req.query.base as string;
  const filePath = req.query.path as string;
  const { content } = req.body;

  if (!base || !filePath) {
    res.status(400).json({ error: "base and path query params required" });
    return;
  }

  if (typeof content !== "string") {
    res.status(400).json({ error: "content string required in body" });
    return;
  }

  const basePath = resolveBase(base);
  if (!basePath || !existsSync(basePath)) {
    res.status(404).json({ error: "Base not found" });
    return;
  }

  const resolved = safePath(basePath, filePath);
  if (!resolved) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  writeFileSync(resolved, content, "utf-8");
  res.json({ saved: true });
});

filesRouter.delete("/", (req, res) => {
  const base = req.query.base as string;
  const filePath = req.query.path as string;

  if (!base || !filePath) {
    res.status(400).json({ error: "base and path query params required" });
    return;
  }

  const basePath = resolveBase(base);
  if (!basePath || !existsSync(basePath)) {
    res.status(404).json({ error: "Base not found" });
    return;
  }

  const resolved = safePath(basePath, filePath);
  if (!resolved) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(resolved)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  unlinkSync(resolved);
  res.json({ deleted: true });
});
