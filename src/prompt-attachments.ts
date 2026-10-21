import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { safeProjectPath } from "./session.js";
import { getAgentPaths } from "./agents/manager.js";
import { byteLimiter, formatSize, truncateUtf8 } from "./byte-utils.js";

const ROOT = resolve(config.dataPath, "prompt-attachments");
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_FILENAME_BYTES = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AttachmentLimitError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface PromptAttachment {
  id: string;
  name: string;
  size: number;
  mediaType: string;
  path: string;
  instruction: string;
}

function ownerSegment(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 32);
}

function targetDir(targetType: string, targetName: string): string | null {
  let dir: string;
  if (targetType === "orchestrator") dir = resolve(ROOT, "orchestrator");
  else if (targetType === "project" && safeProjectPath(targetName)) dir = resolve(ROOT, "project", targetName);
  else if (targetType === "agent" && getAgentPaths(targetName)) dir = resolve(ROOT, "agent", targetName);
  else return null;
  return dir.startsWith(ROOT + sep) ? dir : null;
}

export function promptAttachmentsDir(targetType: string, targetName: string, owner: string): string | null {
  const dir = targetDir(targetType, targetName);
  return dir ? resolve(dir, ownerSegment(owner)) : null;
}

export function existingPromptAttachmentsDir(targetType: string, targetName: string, owner: string): string | null {
  const dir = promptAttachmentsDir(targetType, targetName, owner);
  return dir && existsSync(dir) ? dir : null;
}

function sanitizeFilename(original: string): string {
  const name = basename(original.normalize("NFC"))
    .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
    .replace(/^[.\s]+/, "")
    .trim();
  if (!name) return "arquivo";
  if (Buffer.byteLength(name, "utf8") <= MAX_FILENAME_BYTES) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && Buffer.byteLength(name.slice(dot), "utf8") <= 16 ? name.slice(dot) : "";
  return truncateUtf8(name.slice(0, ext ? dot : undefined), MAX_FILENAME_BYTES - Buffer.byteLength(ext, "utf8")) + ext;
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = resolve(dir, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}

export interface SaveAttachmentInput {
  dir: string;
  originalName: string;
  mediaType: string;
  body: Readable;
  maxBytes: number;
}

export async function savePromptAttachment({ dir, originalName, mediaType, body, maxBytes }: SaveAttachmentInput): Promise<PromptAttachment> {
  const quotaBytes = config.promptAttachmentQuotaMb * 1024 * 1024;
  const used = quotaBytes > 0 ? await directorySize(dir) : 0;
  if (quotaBytes > 0 && used >= quotaBytes) {
    throw new AttachmentLimitError(`Limite de ${config.promptAttachmentQuotaMb} MB de anexos atingido. Remova anexos antigos ou aguarde a limpeza automática.`, 413);
  }
  const limit = quotaBytes > 0 ? Math.min(maxBytes, quotaBytes - used) : maxBytes;

  const id = randomUUID();
  const name = sanitizeFilename(originalName);
  const folder = resolve(dir, id);
  const path = resolve(folder, name);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const limiter = byteLimiter(limit);
  try {
    await pipeline(body, limiter, createWriteStream(path, { mode: 0o600, flags: "wx" }));
  } catch (err) {
    await rm(folder, { recursive: true, force: true });
    throw err;
  }
  if (limiter.exceeded()) {
    await rm(folder, { recursive: true, force: true });
    throw new AttachmentLimitError(limit < maxBytes
      ? `Limite de ${config.promptAttachmentQuotaMb} MB de anexos atingido. Remova anexos antigos ou aguarde a limpeza automática.`
      : `Arquivo maior que ${formatSize(maxBytes)}.`, 413);
  }
  const { size } = await stat(path);
  if (size === 0) {
    await rm(folder, { recursive: true, force: true });
    throw new AttachmentLimitError("Arquivo vazio.", 400);
  }
  const type = mediaType || "application/octet-stream";
  return {
    id,
    name,
    size,
    mediaType: type,
    path,
    instruction: `[Arquivo anexado pelo usuário: ${JSON.stringify(path)} — ${name}, ${type}, ${formatSize(size)}. Você está autorizado a ler este arquivo mesmo que ele esteja fora do seu diretório de trabalho.]`,
  };
}

export async function removePromptAttachment(dir: string, id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  await rm(resolve(dir, id), { recursive: true, force: true });
  return true;
}

export async function purgePromptAttachments(targetType: string, targetName: string): Promise<void> {
  const dir = targetDir(targetType, targetName);
  if (dir) await rm(dir, { recursive: true, force: true });
}

async function subdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => resolve(dir, e.name));
}

export async function sweepExpiredPromptAttachments(now = Date.now()): Promise<number> {
  if (config.promptAttachmentRetentionDays <= 0) return 0;
  const cutoff = now - config.promptAttachmentRetentionDays * DAY_MS;
  const targets = [
    resolve(ROOT, "orchestrator"),
    ...(await subdirectories(resolve(ROOT, "project"))),
    ...(await subdirectories(resolve(ROOT, "agent"))),
  ];
  let removed = 0;
  for (const target of targets) {
    for (const owner of await subdirectories(target)) {
      for (const attachment of await subdirectories(owner)) {
        if (!ID_RE.test(basename(attachment))) continue;
        if ((await stat(attachment)).mtimeMs >= cutoff) continue;
        await rm(attachment, { recursive: true, force: true });
        removed++;
      }
    }
  }
  return removed;
}
