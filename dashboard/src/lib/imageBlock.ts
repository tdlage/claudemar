export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export const MAX_IMAGES_PER_MESSAGE = 100;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGE_IMAGE_BYTES = 32 * 1024 * 1024;

const VISION_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_LONG_EDGE = 2576;
const MAX_VISUAL_TOKENS = 4784;
const PATCH = 28;
const REENCODE_ABOVE_BYTES = 1024 * 1024;
const QUALITIES = [0.9, 0.8, 0.7, 0.6];
const ENCODINGS = ["image/webp", "image/jpeg"] as const;

interface Size {
  width: number;
  height: number;
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;

export function isVisionImage(file: Pick<File, "type">): boolean {
  return VISION_MEDIA_TYPES.has(file.type);
}

export function imageBytes(block: ImageBlock): number {
  return block.source.data.length;
}

export function totalImageBytes(blocks: ImageBlock[]): number {
  return blocks.reduce((sum, block) => sum + imageBytes(block), 0);
}

function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

function visualTokens({ width, height }: Size): number {
  return Math.ceil(width / PATCH) * Math.ceil(height / PATCH);
}

export function visionSize(width: number, height: number): Size {
  const scaled = (scale: number): Size => ({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
  let scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height), Math.sqrt((MAX_VISUAL_TOKENS * PATCH * PATCH) / (width * height)));
  let size = scaled(scale);
  while (visualTokens(size) > MAX_VISUAL_TOKENS) {
    scale *= 0.99;
    size = scaled(scale);
  }
  return size;
}

function createCanvas({ width, height }: Size): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function draw(bitmap: ImageBitmap, size: Size, background?: string): Canvas {
  const canvas = createCanvas(size);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("O navegador não permitiu processar a imagem.");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas;
}

function encode(canvas: Canvas, type: string, quality: number): Promise<Blob | null> {
  if (canvas instanceof HTMLCanvasElement) return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  return canvas.convertToBlob({ type, quality }).catch(() => null);
}

async function compress(bitmap: ImageBitmap, size: Size): Promise<Blob> {
  for (const type of ENCODINGS) {
    const canvas = draw(bitmap, size, type === "image/jpeg" ? "#ffffff" : undefined);
    for (const quality of QUALITIES) {
      const blob = await encode(canvas, type, quality);
      if (!blob || blob.type !== type) break;
      if (base64Length(blob.size) <= MAX_IMAGE_BYTES) return blob;
    }
  }
  throw new Error("Não foi possível reduzir a imagem para o tamanho aceito.");
}

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function toBlock(blob: Blob): Promise<ImageBlock> {
  return { type: "image", source: { type: "base64", media_type: blob.type, data: await readBase64(blob) } };
}

export async function fileToImageBlock(file: File): Promise<ImageBlock> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = visionSize(bitmap.width, bitmap.height);
    const resized = size.width !== bitmap.width || size.height !== bitmap.height;
    if (!resized && file.size <= REENCODE_ABOVE_BYTES) return await toBlock(file);
    const compressed = await compress(bitmap, size);
    const original = !resized && file.size <= compressed.size && base64Length(file.size) <= MAX_IMAGE_BYTES;
    return await toBlock(original ? file : compressed);
  } finally {
    bitmap.close();
  }
}
