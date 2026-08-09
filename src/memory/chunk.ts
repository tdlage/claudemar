export const CHUNK_CHARS = 6000;
export const CHUNK_OVERLAP = 400;

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= CHUNK_CHARS) return trimmed ? [trimmed] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_CHARS, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}
