import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { getAgentPaths } from "./manager.js";
import { formatSize } from "../byte-utils.js";
import { agentSecretsManager, projectSecretsManager } from "../secrets-manager.js";
import { emailSettingsManager } from "../email-settings-manager.js";
import { formatSender } from "../email-profiles.js";
import type { EmailAccess } from "../email-mcp.js";

export function buildSecretsHint(agentName: string): string {
  const secretsJsonPath = agentSecretsManager.secretsJsonPath(agentName);
  if (!existsSync(secretsJsonPath)) return "";
  return `\n[SYSTEM: You have secrets configured. Read ${secretsJsonPath} for credentials, API keys, and secret file paths.]`;
}

export function buildInstructionsBlock(agentsMdPath: string): string {
  if (!existsSync(agentsMdPath)) return "";
  const content = readFileSync(agentsMdPath, "utf-8").trim();
  if (!content) return "";
  return `\n[SYSTEM: Your role and instructions, loaded from ${agentsMdPath}. They are already in this prompt; open the file only to edit it.]\n<agents_md>\n${content}\n</agents_md>`;
}

const TITLE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const TITLE_SCAN_BYTES = 4096;
const MAX_CONTEXT_DEPTH = 5;
const MAX_LISTED_CONTEXT_FILES = 200;

export function readContextTitle(filePath: string): string | null {
  if (!TITLE_EXTENSIONS.has(extname(filePath).toLowerCase())) return null;
  const buffer = Buffer.alloc(TITLE_SCAN_BYTES);
  const fd = openSync(filePath, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, TITLE_SCAN_BYTES, 0);
    let fenced = false;
    for (const line of buffer.toString("utf-8", 0, bytesRead).split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        continue;
      }
      const heading = fenced ? null : /^#{1,3}[ \t]+(\S.*)$/.exec(line);
      if (heading) return heading[1].trim();
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function contextFilePaths(dir: string, depth = 0): string[] {
  if (depth > MAX_CONTEXT_DEPTH) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) return contextFilePaths(path, depth + 1);
      return entry.isFile() ? [path] : [];
    });
}

export function contextFilesSignature(agentName: string): string {
  const paths = getAgentPaths(agentName);
  return paths ? contextFilePaths(paths.context).join("\n") : "";
}

export function buildContextFilesHint(agentName: string): string {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.context)) return "";
  const files = contextFilePaths(paths.context);
  const lines: string[] = [];
  for (const filePath of files.slice(0, MAX_LISTED_CONTEXT_FILES)) {
    try {
      const stats = statSync(filePath);
      const title = readContextTitle(filePath);
      lines.push(`- ${filePath}${title ? ` — "${title}"` : ""} (${formatSize(stats.size)}, modified ${stats.mtime.toISOString()})`);
    } catch { }
  }
  if (files.length > MAX_LISTED_CONTEXT_FILES) {
    lines.push(`- … and ${files.length - MAX_LISTED_CONTEXT_FILES} more file(s); list them with: find ${paths.context} -type f`);
  }
  if (lines.length === 0) return "";
  return `\n[SYSTEM: Your knowledge base lives in ${paths.context}/ (including its subfolders):\n${lines.join("\n")}\nWhen a request touches the subject of any of these files, open and read the file itself before answering; a directory listing or a keyword search is not reading it. Never claim the context lacks something without having read the file. If you already read a file earlier in this conversation and its modification time has not changed since, reuse what you read instead of reading it again.]`;
}

export function buildProjectSecretsHint(projectName: string): string {
  const secretsJsonPath = projectSecretsManager.secretsJsonPath(projectName);
  if (!existsSync(secretsJsonPath)) return "";
  return `\n[SYSTEM: This project has secrets configured. Read ${secretsJsonPath} for credentials, API keys, and secret file paths. You are authorized to read this file and the secret files it lists, even though they are outside your working directory. Never write their values into the repository.]`;
}

export function buildEmailHint(access: EmailAccess): string {
  const senders = emailSettingsManager.sendersFor(access.requester);
  if (senders.length === 0) return "";
  const fallback = emailSettingsManager.defaultSenderOf(senders);
  const defaultFrom = fallback ? ` Without from, it sends as ${fallback.from}.` : " Always pass from.";
  const attachmentScope = access.attachmentRoots ? ` Attachments must be files inside ${access.attachmentRoots.join(" or ")}.` : "";
  return `\n[SYSTEM: You can send emails with the mcp__email__send_email tool (to, subject, body, optional from, html, cc, and attachments as absolute file paths). Senders available to you: ${senders.map(formatSender).join(", ")}.${defaultFrom}${attachmentScope} Use only these senders and send emails only through this tool.]`;
}
