import type { AgentRuntime } from "./types";

const KEY = "slash_commands_cache_v2";
type Cache = Record<string, unknown>;

function read(): Cache {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Cache : {};
  } catch {
    return {};
  }
}

export function slashCacheKey(base: string, runtime: AgentRuntime): string {
  return JSON.stringify([base, runtime]);
}

export function getSlashCache(base: string, runtime: AgentRuntime): string[] {
  const commands = read()[slashCacheKey(base, runtime)];
  return Array.isArray(commands) ? commands.filter((command): command is string => typeof command === "string") : [];
}

export function setSlashCache(base: string, runtime: AgentRuntime, commands: string[]): void {
  const cache = read();
  cache[slashCacheKey(base, runtime)] = commands;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
}
