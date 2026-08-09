import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { dump, load } from "js-yaml";
import { config } from "../config.js";
import { brainRoot, stateDir, wikiDir } from "./paths.js";
import { brainWriteLock, writeFileAtomic } from "./git.js";
import { parseWikiFile, parseWikiFrontmatterLoose, serializeWikiFile } from "./frontmatter.js";
import { dayKeyInTz, hash8 } from "./text.js";
import { invalidateAliasCache } from "./entities.js";
import type { BrainTenant, CompileOpenLoop, OpenLoopEntry, WikiFrontmatter, WikiPageType } from "./types.js";

export const TYPE_DIRS: Record<WikiPageType, string> = {
  person: "people",
  org: "orgs",
  project: "projects",
  topic: "topics",
  thread: "threads",
  lesson: "lessons",
  procedure: "lessons",
  decision: "lessons",
};

export const WIKI_DIRS = [...new Set(Object.values(TYPE_DIRS))];

const REVIEW_WINDOWS: Record<WikiPageType, string> = {
  person: "6m",
  org: "6m",
  project: "3m",
  topic: "6m",
  thread: "12m",
  lesson: "12m",
  procedure: "12m",
  decision: "12m",
};

const HALF_LIVES: Record<WikiPageType, string> = {
  person: "365d",
  org: "365d",
  project: "none",
  topic: "365d",
  thread: "180d",
  lesson: "none",
  procedure: "none",
  decision: "none",
};

function confidenceFor(independentSources: number): "low" | "medium" | "high" {
  if (independentSources >= 3) return "high";
  if (independentSources === 2) return "medium";
  return "low";
}

function mergeSources(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

function today(): string {
  return dayKeyInTz(new Date(), config.brainTz);
}

interface SectionDoc {
  sections: { name: string; content: string }[];
}

function parseSections(body: string): SectionDoc {
  const lines = body.split("\n");
  const sections: { name: string; content: string }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  const preamble: string[] = [];
  for (const line of lines) {
    const match = /^## (.+)$/.exec(line);
    if (match) {
      if (current) sections.push({ name: current.name, content: current.lines.join("\n").trim() });
      current = { name: match[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push({ name: current.name, content: current.lines.join("\n").trim() });
  const pre = preamble.join("\n").trim();
  if (pre) sections.unshift({ name: "", content: pre });
  return { sections };
}

function serializeSections(doc: SectionDoc): string {
  return doc.sections
    .map((s) => (s.name ? `## ${s.name}\n\n${s.content}`.trim() : s.content))
    .filter(Boolean)
    .join("\n\n");
}

async function readPage(relPath: string): Promise<{ frontmatter: WikiFrontmatter; body: string } | null> {
  const abs = resolve(brainRoot, relPath);
  if (!existsSync(abs)) return null;
  return parseWikiFile(await readFile(abs, "utf-8"));
}

async function writePage(relPath: string, frontmatter: WikiFrontmatter, body: string): Promise<void> {
  frontmatter.updated_at = today();
  await writeFileAtomic(resolve(brainRoot, relPath), serializeWikiFile(frontmatter, body));
  invalidateAliasCache();
}

export async function createWikiPage(params: {
  relPath: string;
  type: WikiPageType;
  slug: string;
  title: string;
  tenant: BrainTenant;
  tenantRoot?: BrainTenant;
  aliases: string[];
  sections: { section: string; content: string }[];
  sources: string[];
  containsPii?: 0 | 1;
}): Promise<void> {
  await brainWriteLock(async () => {
    if (existsSync(resolve(brainRoot, params.relPath))) return;
    const sources = mergeSources([], params.sources);
    const frontmatter: WikiFrontmatter = {
      type: params.type,
      slug: params.slug,
      title: params.title,
      tenant: params.tenant,
      tenant_root: params.tenantRoot ?? params.tenant,
      contains_pii: params.containsPii ?? 0,
      aliases: params.aliases,
      status: "active",
      created_at: today(),
      updated_at: today(),
      reviewed_at: today(),
      review_window: REVIEW_WINDOWS[params.type],
      half_life: HALF_LIVES[params.type],
      salience: 0.5,
      related: [],
      sources,
      independent_sources: sources.length,
      confidence: confidenceFor(sources.length),
      pinned: false,
    };
    const body = serializeSections({
      sections: params.sections.map((s) => ({ name: s.section, content: s.content })),
    });
    await writePage(params.relPath, frontmatter, body);
  });
}

export async function upsertSection(
  relPath: string,
  section: string,
  content: string,
  sources: string[],
): Promise<boolean> {
  return brainWriteLock(async () => {
    const page = await readPage(relPath);
    if (!page) return false;
    const doc = parseSections(page.body);
    const existing = doc.sections.find((s) => s.name.toLowerCase() === section.toLowerCase());
    if (existing) existing.content = content;
    else doc.sections.push({ name: section, content });
    page.frontmatter.sources = mergeSources(page.frontmatter.sources, sources);
    page.frontmatter.independent_sources = page.frontmatter.sources.length;
    page.frontmatter.confidence = confidenceFor(page.frontmatter.independent_sources);
    page.frontmatter.salience = Math.min(1, Math.round((page.frontmatter.salience + 0.05) * 100) / 100);
    await writePage(relPath, page.frontmatter, serializeSections(doc));
    return true;
  });
}

export async function appendHistory(
  relPath: string,
  content: string,
  sources: string[],
  docKey: string,
): Promise<boolean> {
  return brainWriteLock(async () => {
    const page = await readPage(relPath);
    if (!page) return false;
    if (page.body.includes(`dk:${docKey}`)) return true;
    const doc = parseSections(page.body);
    let history = doc.sections.find((s) => s.name.toLowerCase() === "histórico" || s.name.toLowerCase() === "historico");
    if (!history) {
      history = { name: "Histórico", content: "" };
      doc.sections.push(history);
    }
    const entry = `- [${today()}] ${content} <!-- dk:${docKey} -->`;
    history.content = history.content ? `${history.content}\n${entry}` : entry;
    page.frontmatter.sources = mergeSources(page.frontmatter.sources, sources);
    page.frontmatter.independent_sources = page.frontmatter.sources.length;
    page.frontmatter.confidence = confidenceFor(page.frontmatter.independent_sources);
    await writePage(relPath, page.frontmatter, serializeSections(doc));
    return true;
  });
}

export async function addRelation(relPath: string, related: string): Promise<boolean> {
  return brainWriteLock(async () => {
    const page = await readPage(relPath);
    if (!page) return false;
    const normalized = related.replace(/^wiki\//, "").replace(/\.md$/, "");
    if (!page.frontmatter.related.includes(normalized)) {
      page.frontmatter.related = [...page.frontmatter.related, normalized].sort();
      await writePage(relPath, page.frontmatter, page.body);
    }
    return true;
  });
}

export async function markSuperseded(
  relPath: string,
  supersededBy: string | null,
  reason: string,
  docKey: string,
): Promise<boolean> {
  return brainWriteLock(async () => {
    const page = await readPage(relPath);
    if (!page) return false;
    if (page.body.includes(`dk:${docKey}`)) return true;
    page.frontmatter.status = "archived";
    const doc = parseSections(page.body);
    const note = `- [${today()}] Superado${supersededBy ? ` por ${supersededBy}` : ""}: ${reason} <!-- dk:${docKey} -->`;
    let history = doc.sections.find((s) => s.name.toLowerCase().startsWith("hist"));
    if (!history) {
      history = { name: "Histórico", content: "" };
      doc.sections.push(history);
    }
    history.content = history.content ? `${history.content}\n${note}` : note;
    await writePage(relPath, page.frontmatter, serializeSections(doc));
    return true;
  });
}

export async function markPagePii(relPath: string): Promise<boolean> {
  return brainWriteLock(async () => {
    const page = await readPage(relPath);
    if (!page || page.frontmatter.contains_pii === 1) return false;
    page.frontmatter.contains_pii = 1;
    await writePage(relPath, page.frontmatter, page.body);
    return true;
  });
}

export async function markReviewed(relPath: string): Promise<boolean> {
  return brainWriteLock(async () => {
    const page = await readPage(relPath);
    if (!page) return false;
    page.frontmatter.reviewed_at = today();
    await writeFileAtomic(resolve(brainRoot, relPath), serializeWikiFile(page.frontmatter, page.body));
    return true;
  });
}

export async function regenerateIndex(): Promise<void> {
  await brainWriteLock(async () => {
    const groups: string[] = ["# Índice do wiki", ""];
    const dirLabels: [string, string][] = [
      ["people", "Pessoas"],
      ["orgs", "Organizações"],
      ["projects", "Projetos"],
      ["topics", "Temas"],
      ["threads", "Threads"],
      ["lessons", "Lições e decisões"],
    ];
    for (const [dir, label] of dirLabels) {
      const abs = resolve(wikiDir, dir);
      const files = existsSync(abs)
        ? (await readdir(abs).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).sort()
        : [];
      if (files.length === 0) continue;
      groups.push(`## ${label}`, "");
      for (const file of files) {
        try {
          const { data } = parseWikiFrontmatterLoose(await readFile(resolve(abs, file), "utf-8"));
          const title = typeof data.title === "string" ? data.title : file.replace(/\.md$/, "");
          const status = typeof data.status === "string" && data.status !== "active" ? ` (${data.status})` : "";
          const updated = typeof data.updated_at === "string" ? ` — ${data.updated_at}` : "";
          groups.push(`- [${title}](${dir}/${file})${status}${updated}`);
        } catch {}
      }
      groups.push("");
    }
    await writeFileAtomic(resolve(wikiDir, "index.md"), groups.join("\n").trimEnd() + "\n");
  });
}

const LOG_HEADER = "# Log de compilação";
const LOG_MAX_LINES = 5000;

const INDEX_COALESCE_MS = 5000;
let indexTimer: NodeJS.Timeout | null = null;
let indexPending: Promise<void> | null = null;

export function scheduleIndexRegeneration(): void {
  if (indexTimer) return;
  indexTimer = setTimeout(() => {
    indexTimer = null;
    indexPending = regenerateIndex()
      .catch((err) => {
        console.error("[brain] falha ao regenerar índice do wiki:", err instanceof Error ? err.message : err);
      })
      .finally(() => {
        indexPending = null;
      });
  }, INDEX_COALESCE_MS);
  indexTimer.unref();
}

export async function flushIndexRegeneration(): Promise<void> {
  if (indexTimer) {
    clearTimeout(indexTimer);
    indexTimer = null;
    await regenerateIndex().catch(() => {});
    return;
  }
  if (indexPending) await indexPending;
}

export async function appendLog(entry: string, docKey: string): Promise<void> {
  await brainWriteLock(async () => {
    const logPath = resolve(wikiDir, "log.md");
    const current = existsSync(logPath) ? await readFile(logPath, "utf-8") : `${LOG_HEADER}\n`;
    if (current.includes(`dk:${docKey}`)) return;
    const line = `${entry.trim()} <!-- dk:${docKey} -->`;
    const lines = current.trimEnd().split("\n").filter((l) => l !== LOG_HEADER);
    lines.push(line);
    const kept = lines.length > LOG_MAX_LINES ? lines.slice(lines.length - LOG_MAX_LINES) : lines;
    await writeFileAtomic(logPath, `${LOG_HEADER}\n${kept.join("\n")}\n`);
  });
}

async function parseOpenLoopsFile(path: string): Promise<OpenLoopEntry[]> {
  if (!existsSync(path)) return [];
  const content = await readFile(path, "utf-8");
  if (!content.trim()) return [];
  let parsed: unknown;
  try {
    parsed = load(content);
  } catch (err) {
    throw new Error(
      `state/open-loops.md ilegível (YAML inválido) — corrija o arquivo antes de continuar: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) throw new Error("state/open-loops.md não contém uma lista de open-loops");
  return parsed as OpenLoopEntry[];
}

export async function appendOpenLoops(
  loops: CompileOpenLoop[],
  sources: string[],
  threadKey: string,
): Promise<number> {
  if (loops.length === 0) return 0;
  return brainWriteLock(async () => {
    const path = resolve(stateDir, "open-loops.md");
    const existing = await parseOpenLoopsFile(path);
    const ids = new Set(existing.map((l) => l.id));
    let added = 0;
    for (const loop of loops) {
      const id = `ol-${hash8(`${threadKey}:${loop.title}`)}`;
      if (ids.has(id)) continue;
      existing.push({
        id,
        title: loop.title,
        tenant: loop.tenant,
        kind: loop.kind,
        counterparty: loop.counterparty,
        opened_at: today(),
        due: loop.due,
        last_movement: today(),
        status: "open",
        supersedes: loop.supersedes,
        sources: mergeSources(loop.sources, sources),
        next_action: loop.next_action,
      });
      ids.add(id);
      added += 1;
    }
    if (added > 0) {
      await writeFileAtomic(path, dump(existing, { lineWidth: -1, noRefs: true }));
    }
    return added;
  });
}

export async function readOpenLoops(): Promise<OpenLoopEntry[]> {
  return parseOpenLoopsFile(resolve(stateDir, "open-loops.md"));
}

export function currentOpenLoops(entries: OpenLoopEntry[]): OpenLoopEntry[] {
  const superseded = new Set(entries.map((e) => e.supersedes).filter((id): id is string => Boolean(id)));
  return entries.filter((e) => !superseded.has(e.id));
}

export async function appendOpenLoopTransition(
  loopId: string,
  status: "open" | "done" | "abandoned",
): Promise<OpenLoopEntry | null> {
  return brainWriteLock(async () => {
    const path = resolve(stateDir, "open-loops.md");
    const entries = await parseOpenLoopsFile(path);
    const current = currentOpenLoops(entries);
    const original = current.find((e) => e.id === loopId);
    if (!original || original.status === status) return null;
    const transition: OpenLoopEntry = {
      ...original,
      id: `ol-${hash8(`${loopId}:${status}:${today()}:${entries.length}`)}`,
      status,
      supersedes: loopId,
      last_movement: today(),
    };
    entries.push(transition);
    await writeFileAtomic(path, dump(entries, { lineWidth: -1, noRefs: true }));
    return transition;
  });
}

export async function relatedPagesText(paths: string[], maxPages: number, maxCharsPerPage = 4000): Promise<string> {
  const chunks: string[] = [];
  for (const relPath of paths.slice(0, maxPages)) {
    const abs = resolve(brainRoot, relPath);
    if (!existsSync(abs)) continue;
    const content = await readFile(abs, "utf-8");
    chunks.push(`===== ${relPath} =====\n${content.slice(0, maxCharsPerPage)}`);
  }
  return chunks.join("\n\n");
}
