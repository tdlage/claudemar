import { formatSize } from "../byte-utils.js";
import type { MessageBlock } from "./types.js";

export const PROMPT_IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_PROMPT_IMAGES = 100;
export const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PROMPT_IMAGES_TOTAL_BYTES = 32 * 1024 * 1024;
export const PROMPT_BODY_LIMIT_BYTES = 40 * 1024 * 1024;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export class MessageBlocksError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message);
  }
}

interface RawImageSource {
  type?: unknown;
  media_type?: unknown;
  data?: unknown;
}

function imageFrom(block: Record<string, unknown>, position: number): MessageBlock {
  const source = (block.source ?? {}) as RawImageSource;
  if (source.type !== "base64" || typeof source.media_type !== "string" || !PROMPT_IMAGE_MEDIA_TYPES.has(source.media_type)) {
    throw new MessageBlocksError(`A imagem ${position} não é PNG, JPEG, GIF ou WebP.`, 400);
  }
  if (typeof source.data !== "string" || !BASE64_RE.test(source.data)) {
    throw new MessageBlocksError(`A imagem ${position} está corrompida.`, 400);
  }
  if (source.data.length > MAX_PROMPT_IMAGE_BYTES) {
    throw new MessageBlocksError(`A imagem ${position} tem ${formatSize(source.data.length)}; o limite por imagem é ${formatSize(MAX_PROMPT_IMAGE_BYTES)}.`, 413);
  }
  return { type: "image", source: { type: "base64", media_type: source.media_type, data: source.data } };
}

export function parseImageBlocks(value: unknown): MessageBlock[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MessageBlocksError("blocks deve ser uma lista.", 400);
  const images: MessageBlock[] = [];
  let total = 0;
  for (const block of value) {
    if (!block || typeof block !== "object") throw new MessageBlocksError("Bloco de mensagem inválido.", 400);
    const { type } = block as { type?: unknown };
    if (type === "text") continue;
    if (type !== "image") throw new MessageBlocksError("Bloco de mensagem inválido.", 400);
    const image = imageFrom(block as Record<string, unknown>, images.length + 1);
    total += image.source!.data.length;
    images.push(image);
  }
  if (images.length > MAX_PROMPT_IMAGES) {
    throw new MessageBlocksError(`A mensagem tem ${images.length} imagens; o limite é ${MAX_PROMPT_IMAGES} por mensagem.`, 413);
  }
  if (total > MAX_PROMPT_IMAGES_TOTAL_BYTES) {
    throw new MessageBlocksError(`As imagens somam ${formatSize(total)}; o limite é ${formatSize(MAX_PROMPT_IMAGES_TOTAL_BYTES)} por mensagem.`, 413);
  }
  return images;
}

export function messageText(text: unknown, blocks: unknown): string {
  if (typeof text === "string") return text;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block): block is { type: "text"; text: string } => !!block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

export function withText(images: MessageBlock[], text: string): MessageBlock[] {
  return text ? [...images, { type: "text", text }] : images;
}
