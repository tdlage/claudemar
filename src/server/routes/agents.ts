import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import { rm } from "node:fs/promises";
import archiver from "archiver";
import { Router } from "express";
import type { Request, Response } from "express";
import {
  createAgentStructure,
  getAgentInfo,
  getAgentPaths,
  isValidAgentName,
  listAgentInfos,
} from "../../agents/manager.js";
import type { AgentPaths } from "../../agents/types.js";
import { listSchedulesByAgent, removeSchedulesByAgent } from "../../agents/scheduler.js";
import { secretsManager } from "../../secrets-manager.js";

export const agentsRouter = Router();

agentsRouter.param("name", (req, res, next) => {
  if (req.ctx?.role === "user" && !req.ctx.agents.includes(req.params.name)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
});

const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

function safeFilename(filename: string): boolean {
  return SAFE_FILENAME_RE.test(filename) && !filename.includes("..");
}

function resolveAgentFile(
  req: Request,
  res: Response,
  subdir: keyof Pick<AgentPaths, "inbox" | "outbox" | "output" | "input" | "context">,
): { paths: AgentPaths; filePath: string } | null {
  const { name, file } = req.params;
  if (!isValidAgentName(name) || !safeFilename(file)) {
    res.status(400).json({ error: "Invalid name or filename" });
    return null;
  }

  const paths = getAgentPaths(name);
  if (!paths) {
    res.status(404).json({ error: "Agent not found" });
    return null;
  }

  const parentDir = paths[subdir];
  const filePath = resolve(parentDir, file);
  if (!filePath.startsWith(parentDir + "/")) {
    res.status(400).json({ error: "Invalid path" });
    return null;
  }

  return { paths, filePath };
}

function resolveOutputPath(
  req: Request,
  res: Response,
): { paths: AgentPaths; filePath: string } | null {
  const name = req.params.name;
  const relativePath = req.params[0];
  if (!isValidAgentName(name) || !relativePath) {
    res.status(400).json({ error: "Invalid name or path" });
    return null;
  }

  const segments = relativePath.split("/");
  if (segments.some((s) => !safeFilename(s))) {
    res.status(400).json({ error: "Invalid path segment" });
    return null;
  }

  const paths = getAgentPaths(name);
  if (!paths) {
    res.status(404).json({ error: "Agent not found" });
    return null;
  }

  const filePath = resolve(paths.output, ...segments);
  if (!filePath.startsWith(paths.output + sep)) {
    res.status(400).json({ error: "Invalid path" });
    return null;
  }

  return { paths, filePath };
}

agentsRouter.get("/", (req, res) => {
  let agents = listAgentInfos();
  if (req.ctx?.role === "user") {
    const allowed = req.ctx.agents;
    agents = agents.filter((a) => allowed.includes(a.name));
  }
  res.json(agents);
});

agentsRouter.get("/:name", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }

  const info = getAgentInfo(name);
  if (!info) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const paths = getAgentPaths(name)!;
  let claudeMd = "";
  const claudeMdPath = resolve(paths.root, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    claudeMd = readFileSync(claudeMdPath, "utf-8");
  }

  let inboxFiles: string[] = [];
  try { inboxFiles = readdirSync(paths.inbox).filter((f) => !f.startsWith(".")).sort(); } catch { /* empty */ }

  let outboxFiles: string[] = [];
  try { outboxFiles = readdirSync(paths.outbox).filter((f) => !f.startsWith(".")).sort(); } catch { /* empty */ }

  let outputFiles: { name: string; type: "file" | "directory"; size: number; mtime: string }[] = [];
  try {
    outputFiles = readdirSync(paths.output)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(paths.output, f));
        return { name: f, type: stat.isDirectory() ? "directory" as const : "file" as const, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return b.mtime.localeCompare(a.mtime);
      });
  } catch { /* empty */ }

  let inputFiles: { name: string; size: number; mtime: string }[] = [];
  try {
    inputFiles = readdirSync(paths.input)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(paths.input, f));
        return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch { /* empty */ }

  let contextFiles: string[] = [];
  try { contextFiles = readdirSync(paths.context).filter((f) => !f.startsWith(".")).sort(); } catch { /* empty */ }

  const schedules = listSchedulesByAgent(name);
  const secrets = secretsManager.getMaskedSecrets(name);
  const secretFiles = secretsManager.getSecretFiles(name);

  res.json({
    ...info,
    claudeMd,
    inboxFiles,
    outboxFiles,
    outputFiles,
    inputFiles,
    contextFiles,
    schedules,
    secrets,
    secretFiles,
  });
});

agentsRouter.post("/", (req, res) => {
  if (req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { name } = req.body;
  if (!name || !isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }

  const paths = getAgentPaths(name);
  if (paths && existsSync(paths.root)) {
    res.status(409).json({ error: "Agent already exists" });
    return;
  }

  const created = createAgentStructure(name);
  if (!created) {
    res.status(500).json({ error: "Failed to create agent" });
    return;
  }

  res.status(201).json({ name, paths: created });
});

agentsRouter.delete("/:name", async (req, res) => {
  if (req.ctx?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }

  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const removedSchedules = removeSchedulesByAgent(name);
  await rm(paths.root, { recursive: true, force: true });

  res.json({ removed: name, removedSchedules });
});

agentsRouter.get("/:name/inbox/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "inbox");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const content = readFileSync(result.filePath, "utf-8");
  const stat = statSync(result.filePath);
  res.json({ name: req.params.file, content, size: stat.size, mtime: stat.mtime.toISOString() });
});

agentsRouter.post("/:name/inbox/:file/archive", (req, res) => {
  const result = resolveAgentFile(req, res, "inbox");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const archivedDir = resolve(result.paths.inbox, "archived");
  mkdirSync(archivedDir, { recursive: true });
  const archivePath = resolve(archivedDir, req.params.file);
  if (!archivePath.startsWith(archivedDir + "/")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  renameSync(result.filePath, archivePath);
  res.json({ archived: true });
});

agentsRouter.delete("/:name/inbox/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "inbox");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  unlinkSync(result.filePath);
  res.json({ deleted: true });
});

agentsRouter.post("/:name/outbox", (req, res) => {
  const { name } = req.params;
  const { recipient, content } = req.body;

  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  if (!recipient || !isValidAgentName(recipient)) {
    res.status(400).json({ error: "Invalid recipient" });
    return;
  }
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content string required" });
    return;
  }

  const paths = getAgentPaths(name);
  if (!paths) { res.status(404).json({ error: "Agent not found" }); return; }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `PARA-${recipient}_${timestamp}_reply.md`;
  writeFileSync(resolve(paths.outbox, filename), content, "utf-8");
  res.status(201).json({ created: filename });
});

agentsRouter.get("/:name/outbox/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "outbox");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const content = readFileSync(result.filePath, "utf-8");
  const stat = statSync(result.filePath);
  res.json({ name: req.params.file, content, size: stat.size, mtime: stat.mtime.toISOString() });
});

agentsRouter.delete("/:name/outbox/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "outbox");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  unlinkSync(result.filePath);
  res.json({ deleted: true });
});

function listOutputDir(dir: string) {
  return readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((f) => {
      const stat = statSync(resolve(dir, f));
      return { name: f, type: stat.isDirectory() ? "directory" as const : "file" as const, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return b.mtime.localeCompare(a.mtime);
    });
}

agentsRouter.get("/:name/output", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const subpath = typeof req.query.path === "string" ? req.query.path : "";
  const targetDir = subpath ? resolve(paths.output, subpath) : paths.output;
  if (!targetDir.startsWith(paths.output + sep) && targetDir !== paths.output) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    res.status(404).json({ error: "Directory not found" });
    return;
  }

  try {
    res.json(listOutputDir(targetDir));
  } catch {
    res.json([]);
  }
});

agentsRouter.get("/:name/output/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "output");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(result.filePath);
  if (stat.size > 2 * 1024 * 1024) {
    res.status(413).json({ error: "File too large" });
    return;
  }

  const content = readFileSync(result.filePath, "utf-8");
  res.json({ name: req.params.file, content, size: stat.size, mtime: stat.mtime.toISOString() });
});

agentsRouter.get("/:name/output-dl/*", (req, res) => {
  const result = resolveOutputPath(req, res);
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(result.filePath);
  const basename = result.filePath.split(sep).pop()!;
  if (stat.isDirectory()) {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${basename}.zip"`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "Zip failed" });
    });
    archive.pipe(res);
    archive.directory(result.filePath, basename);
    archive.finalize();
    return;
  }

  res.download(result.filePath, basename);
});

agentsRouter.delete("/:name/output-rm/*", async (req, res) => {
  const result = resolveOutputPath(req, res);
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(result.filePath);
  if (stat.isDirectory()) {
    await rm(result.filePath, { recursive: true, force: true });
  } else {
    unlinkSync(result.filePath);
  }
  res.json({ deleted: true });
});

agentsRouter.get("/:name/input", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  try {
    const files = readdirSync(paths.input)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(paths.input, f));
        return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(files);
  } catch {
    res.json([]);
  }
});

agentsRouter.post("/:name/input", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

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

  mkdirSync(paths.input, { recursive: true });
  const filePath = resolve(paths.input, filename);
  if (!filePath.startsWith(paths.input + "/")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  writeFileSync(filePath, data);
  const stat = statSync(filePath);
  res.status(201).json({ name: filename, size: stat.size, mtime: stat.mtime.toISOString() });
});

agentsRouter.get("/:name/input/:file/download", (req, res) => {
  const result = resolveAgentFile(req, res, "input");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.download(result.filePath, req.params.file);
});

agentsRouter.delete("/:name/input/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "input");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  unlinkSync(result.filePath);
  res.json({ deleted: true });
});

agentsRouter.get("/:name/context/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "context");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(result.filePath);
  if (stat.size > 2 * 1024 * 1024) {
    res.status(413).json({ error: "File too large" });
    return;
  }

  const content = readFileSync(result.filePath, "utf-8");
  res.json({ name: req.params.file, content, size: stat.size, mtime: stat.mtime.toISOString() });
});

agentsRouter.delete("/:name/context/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "context");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  unlinkSync(result.filePath);
  res.json({ deleted: true });
});

agentsRouter.post("/:name/context", (req, res) => {
  const { name } = req.params;
  const { filename, content } = req.body;

  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  if (!filename || !safeFilename(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content string required" });
    return;
  }

  const paths = getAgentPaths(name);
  if (!paths) { res.status(404).json({ error: "Agent not found" }); return; }

  mkdirSync(paths.context, { recursive: true });
  const filePath = resolve(paths.context, filename);
  if (!filePath.startsWith(paths.context + "/")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  if (existsSync(filePath)) {
    res.status(409).json({ error: "File already exists" });
    return;
  }

  writeFileSync(filePath, content, "utf-8");
  res.status(201).json({ created: filename });
});

agentsRouter.put("/:name/context/:file", (req, res) => {
  const result = resolveAgentFile(req, res, "context");
  if (!result) return;

  if (!existsSync(result.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const { content } = req.body;
  if (typeof content !== "string") {
    res.status(400).json({ error: "content string required" });
    return;
  }

  writeFileSync(result.filePath, content, "utf-8");
  res.json({ updated: true });
});

agentsRouter.get("/:name/secrets", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(secretsManager.getMaskedSecrets(name));
});

agentsRouter.post("/:name/secrets", (req, res) => {
  const { name } = req.params;
  const { name: secretName, value, description } = req.body;

  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  if (!secretName || typeof secretName !== "string") {
    res.status(400).json({ error: "name (string) required" });
    return;
  }
  if (!value || typeof value !== "string") {
    res.status(400).json({ error: "value (string) required" });
    return;
  }

  const created = secretsManager.createSecret(name, secretName, value, description || "");
  res.status(201).json(created);
});

agentsRouter.put("/:name/secrets/:id", (req, res) => {
  const { name, id } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }

  const { name: secretName, value, description } = req.body;
  const updated = secretsManager.updateSecret(name, id, { name: secretName, value, description });
  if (!updated) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }
  res.json(updated);
});

agentsRouter.delete("/:name/secrets/:id", (req, res) => {
  const { name, id } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }

  const deleted = secretsManager.deleteSecret(name, id);
  if (!deleted) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }
  res.json({ deleted: true });
});

agentsRouter.get("/:name/secrets/files", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(secretsManager.getSecretFiles(name));
});

agentsRouter.post("/:name/secrets/files", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) {
    res.status(400).json({ error: "Invalid agent name" });
    return;
  }
  const paths = getAgentPaths(name);
  if (!paths || !existsSync(paths.root)) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const { filename, content, description } = req.body;
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

  const info = secretsManager.saveSecretFile(name, filename, data);
  if (description && typeof description === "string") {
    secretsManager.updateSecretFileDescription(name, filename, description);
    info.description = description;
  }
  res.status(201).json(info);
});

agentsRouter.put("/:name/secrets/files/:file/description", (req, res) => {
  const { name, file } = req.params;
  if (!isValidAgentName(name) || !safeFilename(file)) {
    res.status(400).json({ error: "Invalid name or filename" });
    return;
  }

  const { description } = req.body;
  if (typeof description !== "string") {
    res.status(400).json({ error: "description string required" });
    return;
  }

  const updated = secretsManager.updateSecretFileDescription(name, file, description);
  if (!updated) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.json({ updated: true });
});

agentsRouter.delete("/:name/secrets/files/:file", (req, res) => {
  const { name, file } = req.params;
  if (!isValidAgentName(name) || !safeFilename(file)) {
    res.status(400).json({ error: "Invalid name or filename" });
    return;
  }

  const deleted = secretsManager.deleteSecretFile(name, file);
  if (!deleted) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.json({ deleted: true });
});
