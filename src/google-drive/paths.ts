import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { config } from "../config.js";
import { getAgentPaths } from "../agents/manager.js";

export const DRIVE_INPUT_DIR = "google-drive";

const manifestsDir = resolve(config.dataPath, "google-drive", "manifests");
const gitExcludePattern = `/input/${DRIVE_INPUT_DIR}/`;

export function driveInputRoot(agentName: string): string | null {
  const paths = getAgentPaths(agentName);
  return paths ? resolve(paths.input, DRIVE_INPUT_DIR) : null;
}

export function manifestPath(linkId: string): string {
  return resolve(manifestsDir, `${linkId}.json`);
}

export function isDriveMirrorPath(path: string): boolean {
  if (!path.startsWith(config.agentsPath + sep)) return false;
  const parts = path.slice(config.agentsPath.length + 1).split(sep);
  return parts.length >= 3 && parts[1] === "input" && parts[2] === DRIVE_INPUT_DIR;
}

export async function excludeFromAgentGit(agentRoot: string): Promise<void> {
  const gitDir = resolve(agentRoot, ".git");
  if (!(await stat(gitDir).catch(() => null))?.isDirectory()) return;
  const excludeFile = resolve(gitDir, "info", "exclude");
  const current = await readFile(excludeFile, "utf-8").catch(() => "");
  if (current.split("\n").some((line) => line.trim() === gitExcludePattern)) return;
  await mkdir(resolve(gitDir, "info"), { recursive: true });
  await appendFile(excludeFile, `${current && !current.endsWith("\n") ? "\n" : ""}${gitExcludePattern}\n`);
}
