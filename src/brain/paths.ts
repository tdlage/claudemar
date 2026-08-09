import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { config } from "../config.js";

export const brainRoot = config.brainRoot;
export const rawDir = resolve(brainRoot, "raw");
export const wikiDir = resolve(brainRoot, "wiki");
export const stateDir = resolve(brainRoot, "state");
export const quarantineDir = resolve(stateDir, "quarantine");
export const quarantineDiscardedDir = resolve(quarantineDir, ".discarded");
export const attachmentsDir = resolve(brainRoot, "attachments");
export const telemetryDir = resolve(stateDir, "telemetry");

export function ensureBrainTree(): void {
  const dirs = [
    rawDir,
    wikiDir,
    resolve(wikiDir, "people"),
    resolve(wikiDir, "orgs"),
    resolve(wikiDir, "projects"),
    resolve(wikiDir, "topics"),
    resolve(wikiDir, "threads"),
    resolve(wikiDir, "lessons"),
    stateDir,
    quarantineDir,
    quarantineDiscardedDir,
    resolve(stateDir, "digest"),
    resolve(stateDir, "lint"),
    telemetryDir,
    attachmentsDir,
  ];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
  const gitignore = resolve(brainRoot, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "attachments/\n*.tmp\n");
  const pins = resolve(stateDir, "pins.md");
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
