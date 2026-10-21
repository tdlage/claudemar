import { Transform } from "node:stream";

export function truncateUtf8(value: string, maxBytes: number): string {
  let out = "";
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Sem onExceeded o excedente é descartado e o stream segue até o fim (para o cliente ler a
// resposta de limite); com onExceeded o stream falha assim que o limite é ultrapassado.
export function byteLimiter(maxBytes: number, onExceeded?: () => Error): Transform & { exceeded: () => boolean } {
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Uint8Array, _encoding, done) {
      received += chunk.length;
      if (received <= maxBytes) done(null, chunk);
      else if (onExceeded) done(onExceeded());
      else done();
    },
  });
  return Object.assign(limiter, { exceeded: () => received > maxBytes });
}
