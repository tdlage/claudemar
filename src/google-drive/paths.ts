import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { config } from "../config.js";
import { getAgentPaths } from "../agents/manager.js";
import { safeProjectPath } from "../session.js";
import type { DriveTarget } from "./store.js";

export const DRIVE_INPUT_DIR = "google-drive";

const manifestsDir = resolve(config.dataPath, "google-drive", "manifests");

export interface DriveTargetPaths {
  root: string;
  input: string;
  output: string;
  inputLabel: string;
  outputLabel: string;
}

const PROJECT_INPUT_DIR = ".input";
const PROJECT_OUTPUT_DIR = ".output";

export function driveTargetPaths(target: DriveTarget): DriveTargetPaths | null {
  if (target.type === "agent") {
    const paths = getAgentPaths(target.name);
    return paths ? { root: paths.root, input: paths.input, output: paths.output, inputLabel: "input", outputLabel: "output" } : null;
  }
  const root = safeProjectPath(target.name);
  if (!root) return null;
  return {
    root,
    input: resolve(root, PROJECT_INPUT_DIR),
    output: resolve(root, PROJECT_OUTPUT_DIR),
    inputLabel: PROJECT_INPUT_DIR,
    outputLabel: PROJECT_OUTPUT_DIR,
  };
}

export function driveInputRoot(target: DriveTarget): string | null {
  const paths = driveTargetPaths(target);
  return paths ? resolve(paths.input, DRIVE_INPUT_DIR) : null;
}

export function manifestPath(linkId: string): string {
  return resolve(manifestsDir, `${linkId}.json`);
}

function isMirrorUnder(path: string, base: string, inputDir: string): boolean {
  if (!path.startsWith(base + sep)) return false;
  const parts = path.slice(base.length + 1).split(sep);
  return parts.length >= 3 && parts[1] === inputDir && parts[2] === DRIVE_INPUT_DIR;
}

export function isDriveMirrorPath(path: string): boolean {
  return isMirrorUnder(path, config.agentsPath, "input") || isMirrorUnder(path, config.projectsPath, PROJECT_INPUT_DIR);
}

export async function excludeMirrorFromGit(paths: DriveTargetPaths): Promise<void> {
  const gitDir = resolve(paths.root, ".git");
  if (!(await stat(gitDir).catch(() => null))?.isDirectory()) return;
  const pattern = `/${paths.inputLabel}/${DRIVE_INPUT_DIR}/`;
  const excludeFile = resolve(gitDir, "info", "exclude");
  const current = await readFile(excludeFile, "utf-8").catch(() => "");
  if (current.split("\n").some((line) => line.trim() === pattern)) return;
  await mkdir(resolve(gitDir, "info"), { recursive: true });
  await appendFile(excludeFile, `${current && !current.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}
