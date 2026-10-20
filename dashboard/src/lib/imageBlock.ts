export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

const VISION_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isVisionImage(file: Pick<File, "type">): boolean {
  return VISION_MEDIA_TYPES.has(file.type);
}

export function fileToImageBlock(file: File): Promise<ImageBlock> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.split(",")[1] ?? "";
      resolve({ type: "image", source: { type: "base64", media_type: file.type || "image/png", data } });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

