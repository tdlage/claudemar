import { beforeEach, expect, it } from "vitest";
import { getSlashCache, setSlashCache } from "./slashCache";

beforeEach(() => localStorage.clear());

it("isolates runtimes and projects in persisted state", () => {
  setSlashCache("a", "claude", ["cost"]);
  setSlashCache("a", "codex", []);
  setSlashCache("b", "claude", ["review"]);
  expect(getSlashCache("a", "claude")).toEqual(["cost"]);
  expect(getSlashCache("a", "codex")).toEqual([]);
  expect(getSlashCache("b", "claude")).toEqual(["review"]);
});

it("persists empty lists to clear obsolete commands", () => {
  setSlashCache("a", "claude", ["cost"]);
  setSlashCache("a", "claude", []);
  expect(getSlashCache("a", "claude")).toEqual([]);
});

it("discards legacy commands whose runtime is unknown", () => {
  localStorage.setItem("slash_commands_cache", JSON.stringify({ a: ["cost"] }));
  expect(getSlashCache("a", "claude")).toEqual([]);
  expect(getSlashCache("a", "codex")).toEqual([]);
});

it("tolerates malformed persisted values", () => {
  for (const value of ["null", "[]", "invalid"]) {
    localStorage.setItem("slash_commands_cache_v2", value);
    expect(getSlashCache("a", "codex")).toEqual([]);
    setSlashCache("a", "codex", []);
  }
});
