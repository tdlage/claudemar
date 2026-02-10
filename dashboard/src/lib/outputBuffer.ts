const buffer = new Map<string, string>();

export function getOutput(id: string): string {
  return buffer.get(id) ?? "";
}

export function setOutput(id: string, output: string): void {
  buffer.set(id, output);
}

export function appendOutput(id: string, chunk: string): void {
  buffer.set(id, (buffer.get(id) ?? "") + chunk);
}

export function seedOutput(id: string, output: string): void {
  if (!buffer.has(id) && output) {
    buffer.set(id, output);
  }
}
