import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import type { MessageBlock } from "./runtime/types.js";

export interface QueuedImage {
  file: string;
  mediaType: string;
}

const ATTACHMENTS_DIR = resolve(config.dataPath, "queue-attachments");

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function itemDir(itemId: string): string {
  return resolve(ATTACHMENTS_DIR, itemId);
}

export function saveQueueImages(itemId: string, blocks: MessageBlock[]): QueuedImage[] {
  const images = blocks.filter((block) => block.type === "image" && block.source?.data);
  if (images.length === 0) return [];
  const dir = itemDir(itemId);
  mkdirSync(dir, { recursive: true });
  return images.map((block, index) => {
    const mediaType = block.source!.media_type;
    const file = `${index}.${EXTENSIONS[mediaType] ?? "bin"}`;
    writeFileSync(resolve(dir, file), Buffer.from(block.source!.data, "base64"));
    return { file, mediaType };
  });
}

export function loadQueueImages(itemId: string, images: QueuedImage[]): MessageBlock[] {
  const dir = itemDir(itemId);
  return images.map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: readFileSync(resolve(dir, image.file)).toString("base64") },
  }));
}

export function removeQueueImages(itemId: string): void {
  rmSync(itemDir(itemId), { recursive: true, force: true });
}

export function pruneQueueImages(activeIds: Set<string>): void {
  if (!existsSync(ATTACHMENTS_DIR)) return;
  for (const entry of readdirSync(ATTACHMENTS_DIR)) {
    if (!activeIds.has(entry)) removeQueueImages(entry);
  }
}
