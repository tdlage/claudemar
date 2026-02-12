const MAX_BUFFER_ENTRIES = 250;

const buffer = new Map<string, string>();

export function getOutput(id: string): string {
  return buffer.get(id) ?? "";
}

export function setOutput(id: string, output: string): void {
  buffer.set(id, output);
  evict();
}

export function appendOutput(id: string, chunk: string): void {
  buffer.set(id, (buffer.get(id) ?? "") + chunk);
}

export function seedOutput(id: string, output: string): void {
  if (!buffer.has(id) && output) {
    buffer.set(id, output);
    evict();
  }
}

export function clearOutput(id: string): void {
  buffer.delete(id);
}

function evict(): void {
  if (buffer.size <= MAX_BUFFER_ENTRIES) return;
  const it = buffer.keys();
  while (buffer.size > MAX_BUFFER_ENTRIES) {
    const oldest = it.next();
    if (oldest.done) break;
    buffer.delete(oldest.value);
  }
}
