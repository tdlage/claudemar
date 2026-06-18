export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type MessageBlock = ImageBlock | TextBlock;

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

export async function imageBlocksFromClipboard(clipboardData: DataTransfer): Promise<ImageBlock[]> {
  const items = Array.from(clipboardData.items).filter((i) => i.type.startsWith("image/"));
  const files = items.map((i) => i.getAsFile()).filter((f): f is File => !!f);
  return Promise.all(files.map(fileToImageBlock));
}
