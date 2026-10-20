import { api } from "./api";

export const MAX_PROMPT_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export interface PromptAttachment {
  id: string;
  name: string;
  size: number;
  mediaType: string;
  instruction: string;
}

export function uploadPromptAttachment(base: string, file: File): Promise<PromptAttachment> {
  const params = new URLSearchParams({ base, filename: file.name || "arquivo" });
  if (file.type) params.set("type", file.type);
  return api.upload<PromptAttachment>(`/prompt-attachments?${params}`, file);
}

export function removePromptAttachment(base: string, id: string): Promise<{ removed: boolean }> {
  return api.delete(`/prompt-attachments/${encodeURIComponent(id)}?base=${encodeURIComponent(base)}`);
}
