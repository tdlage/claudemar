import { relative } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { config } from "../config.js";

export type FileChangeEvent = "change" | "add" | "unlink";
export type FileChangeCallback = (
  event: FileChangeEvent,
  base: string,
  relativePath: string,
) => void;

interface WatchedBase {
  path: string;
  base: string;
}

let watcher: FSWatcher | null = null;

function resolveBase(
  filePath: string,
  watchedBases: WatchedBase[],
): { base: string; relativePath: string } | null {
  for (const wb of watchedBases) {
    if (filePath.startsWith(wb.path + "/")) {
      const rel = relative(wb.path, filePath);
      return { base: wb.base, relativePath: rel };
    }
  }
  return null;
}

function buildAgentBases(): WatchedBase[] {
  return [];
}

export function startFileWatcher(callback: FileChangeCallback): void {
  if (watcher) return;

  const watchedBases: WatchedBase[] = [
    { path: config.orchestratorPath, base: "orchestrator" },
    { path: config.agentsPath, base: "__agents_root__" },
    { path: config.projectsPath, base: "__projects_root__" },
    ...buildAgentBases(),
  ];

  const paths = [
    config.orchestratorPath,
    config.agentsPath,
    config.projectsPath,
  ];

  watcher = watch(paths, {
    ignored: [/node_modules/, /\.git/, /archived/],
    depth: 5,
    ignoreInitial: true,
    persistent: true,
  });

  const handleEvent = (event: FileChangeEvent, filePath: string) => {
    let resolved = resolveBase(filePath, watchedBases);

    if (!resolved) return;

    if (resolved.base === "__agents_root__") {
      const parts = resolved.relativePath.split("/");
      if (parts.length < 2) return;
      resolved = {
        base: `agent:${parts[0]}`,
        relativePath: parts.slice(1).join("/"),
      };
    } else if (resolved.base === "__projects_root__") {
      const parts = resolved.relativePath.split("/");
      if (parts.length < 2) return;
      resolved = {
        base: `project:${parts[0]}`,
        relativePath: parts.slice(1).join("/"),
      };
    }

    callback(event, resolved.base, resolved.relativePath);
  };

  watcher.on("change", (path) => handleEvent("change", path as string));
  watcher.on("add", (path) => handleEvent("add", path as string));
  watcher.on("unlink", (path) => handleEvent("unlink", path as string));
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
