import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { BrainScope } from "./scope.js";

export function ensureBrainTree(scope: BrainScope): void {
  if (!scope.isAdmin) {
    mkdirSync(scope.privateDir, { recursive: true, mode: 0o700 });
    chmodSync(scope.privateDir, 0o700);
    mkdirSync(scope.root, { recursive: true, mode: 0o700 });
    chmodSync(scope.root, 0o700);
  }
  const dirs = [
    scope.rawDir,
    scope.wikiDir,
    resolve(scope.wikiDir, "people"),
    resolve(scope.wikiDir, "orgs"),
    resolve(scope.wikiDir, "projects"),
    resolve(scope.wikiDir, "topics"),
    resolve(scope.wikiDir, "threads"),
    resolve(scope.wikiDir, "lessons"),
    scope.stateDir,
    scope.quarantineDir,
    scope.quarantineDiscardedDir,
    resolve(scope.stateDir, "digest"),
    resolve(scope.stateDir, "lint"),
    scope.telemetryDir,
    scope.attachmentsDir,
  ];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
  const gitignore = resolve(scope.root, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "attachments/\n*.tmp\n");
  const pins = resolve(scope.stateDir, "pins.md");
  if (!existsSync(pins)) {
    writeFileSync(
      pins,
      "# Pins\n\nPáginas listadas aqui (uma por linha, caminho wiki/...) nunca são propostas para remoção ou arquivamento pelo lint.\n",
    );
  }
}

export function resolveInside(base: string, rel: string): string | null {
  if (!rel || isAbsolute(rel) || rel.includes("\0")) return null;
  const abs = resolve(base, rel);
  const back = relative(base, abs);
  if (back.startsWith("..") || isAbsolute(back)) return null;
  return abs;
}
