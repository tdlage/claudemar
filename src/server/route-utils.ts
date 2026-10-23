import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { raw } from "express";
import type { Request, Response } from "express";

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    });
  };
}

export const MAX_INPUT_FILE_BYTES = 100 * 1024 * 1024;

export const inputUploadParser = raw({ type: "application/octet-stream", limit: MAX_INPUT_FILE_BYTES });

const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

export function safeFilename(filename: unknown): filename is string {
  return typeof filename === "string" && SAFE_FILENAME_RE.test(filename) && !filename.includes("..");
}

// RFC 6266: fallback ASCII em filename e o nome UTF-8 em filename* (RFC 5987).
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function safePathSegment(segment: unknown): segment is string {
  return typeof segment === "string"
    && segment.length > 0
    && Buffer.byteLength(segment) <= 255
    && segment !== "."
    && segment !== ".."
    && !/[/\\\0]/.test(segment);
}

export interface FileStat {
  name: string;
  size: number;
  mtime: string;
}

export interface DirEntry extends FileStat {
  type: "file" | "directory";
}

export function listFiles(dir: string): FileStat[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(dir, f));
        return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

export function listDirEntries(dir: string): DirEntry[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const stat = statSync(resolve(dir, f));
        return {
          name: f,
          type: stat.isDirectory() ? "directory" as const : "file" as const,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return b.mtime.localeCompare(a.mtime);
      });
  } catch {
    return [];
  }
}
