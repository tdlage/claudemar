import { config } from "../config.js";

export interface SparseVector {
  indices: number[];
  values: number[];
}

const HASH_SPACE = 1 << 20;

function hashTerm(term: string): number {
  let hash = 2166136261;
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % HASH_SPACE;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

export function bm25Vector(text: string): SparseVector | null {
  if (!config.hybridBm25) return null;

  const counts = new Map<number, number>();
  for (const token of tokenize(text)) {
    const idx = hashTerm(token);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const indices: number[] = [];
  const values: number[] = [];
  for (const [idx, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    indices.push(idx);
    values.push(count);
  }

  return { indices, values };
}
