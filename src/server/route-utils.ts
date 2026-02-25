import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

export function safeFilename(filename: string): boolean {
  return SAFE_FILENAME_RE.test(filename) && !filename.includes("..");
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
