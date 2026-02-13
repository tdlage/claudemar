import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, sep, relative, extname, basename } from "node:path";
import { Router } from "express";
import { config } from "../../config.js";
import { getAgentPaths, isValidAgentName } from "../../agents/manager.js";
import { safeProjectPath } from "../../session.js";

export const filesRouter = Router();

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm",
  ".css", ".scss", ".less", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".rs", ".go", ".java", ".kt", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".swift", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".sql", ".graphql", ".gql", ".env", ".ini", ".cfg", ".conf", ".properties",
  ".csv", ".tsv", ".log", ".svg", ".vue", ".svelte", ".astro", ".mdx",
  ".dockerfile", ".gitignore", ".gitattributes", ".editorconfig", ".eslintrc",
  ".prettierrc", ".lock", ".prisma", ".tf", ".hcl", ".lua", ".r", ".m",
  ".php", ".pl", ".pm", ".ex", ".exs", ".erl", ".hs", ".ml", ".clj",
]);

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

  if (TEXT_EXTENSIONS.has(ext) || ext === "" || resolved.endsWith("Makefile") || resolved.endsWith("Dockerfile")) {
    const content = readFileSync(resolved, "utf-8");
    res.json({ type: "file", content, size: stat.size });
    return;
  }

  const fd = openSync(resolved, "r");
  let bytesRead: number;
  const sample = Buffer.alloc(8192);
  try {
    bytesRead = readSync(fd, sample, 0, 8192, 0);
  } finally {
    closeSync(fd);
  }

  for (let i = 0; i < bytesRead; i++) {
    if (sample[i] === 0) {
      res.json({ type: "file", binary: true, size: stat.size });
      return;
    }
  }

  const content = readFileSync(resolved, "utf-8");
  res.json({ type: "file", content, size: stat.size });
});

filesRouter.get("/download", (req, res) => {
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
  if (!resolved || !existsSync(resolved)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    res.status(400).json({ error: "Cannot download a directory" });
    return;
  }

  res.download(resolved, basename(resolved));
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

const MAX_SEARCH_RESULTS = 500;

filesRouter.get("/search", (req, res) => {
  const base = req.query.base as string;
  const query = req.query.query as string;
  const useRegex = req.query.regex === "true";
  const caseSensitive = req.query.caseSensitive === "true";
  const wholeWord = req.query.wholeWord === "true";

  if (!base || !query) {
    res.status(400).json({ error: "base and query params required" });
    return;
  }

  const basePath = resolveBase(base);
  if (!basePath || !existsSync(basePath)) {
    res.status(404).json({ error: "Base not found" });
    return;
  }

  const args = ["-rn", "--include=*.*", `-m`, String(MAX_SEARCH_RESULTS)];
  if (!caseSensitive) args.push("-i");
  if (!useRegex) args.push("-F");
  if (wholeWord) args.push("-w");
  args.push("--", query, basePath);

  execFile("grep", args, { maxBuffer: 5 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
    if (err && (err as NodeJS.ErrnoException).code !== "1" && err.killed !== false) {
      if (!stdout) {
        res.json({ results: {}, count: 0 });
        return;
      }
    }

    const results: Record<string, Array<{ line: number; content: string }>> = {};
    let count = 0;
    const lines = (stdout || "").trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const sepIdx = line.indexOf(":");
      if (sepIdx === -1) continue;
      const rest = line.slice(sepIdx + 1);
      const sepIdx2 = rest.indexOf(":");
      if (sepIdx2 === -1) continue;

      const filePath = line.slice(0, sepIdx);
      const lineNum = parseInt(rest.slice(0, sepIdx2), 10);
      const content = rest.slice(sepIdx2 + 1);

      if (isNaN(lineNum)) continue;

      const relPath = relative(basePath, filePath);
      if (relPath.startsWith("..")) continue;

      if (!results[relPath]) results[relPath] = [];
      results[relPath].push({ line: lineNum, content: content.slice(0, 500) });
      count++;
    }

    res.json({ results, count });
  });
});
