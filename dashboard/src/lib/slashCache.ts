const KEY = "slash_commands_cache";

type Cache = Record<string, string[]>;

function read(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Cache;
  } catch {
    return {};
  }
}

export function getSlashCache(base: string): string[] {
  return read()[base] ?? [];
}

export function setSlashCache(base: string, commands: string[]): void {
  if (commands.length === 0) return;
  const cache = read();
  cache[base] = commands;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
}
