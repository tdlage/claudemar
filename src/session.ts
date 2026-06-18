import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { config } from "./config.js";

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_RE.test(name);
}

export function safeProjectPath(name: string): string | null {
  if (!isValidProjectName(name)) return null;
  const resolved = resolve(config.projectsPath, name);
  if (!resolved.startsWith(config.projectsPath + sep)) return null;
  return resolved;
}

export function listProjects(): string[] {
  try {
    const entries = readdirSync(config.projectsPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
