const MAX_ENTRIES = 500;

const cache = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
  evict();
}

export function deleteCached(key: string): void {
  cache.delete(key);
}

function evict(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const it = cache.keys();
  while (cache.size > MAX_ENTRIES) {
    const oldest = it.next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}
