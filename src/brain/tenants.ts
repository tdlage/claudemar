import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { dump, load } from "js-yaml";
import { config } from "../config.js";
import { stateDir } from "./paths.js";
import { brainWriteLock, writeFileAtomic } from "./git.js";
import { dayKeyInTz, normalizeForIndex, slugify } from "./text.js";
import type { TenantEntry } from "./types.js";

export const ROOT_TENANT = "personal";
const MAX_DEPTH = 8;

const REGISTRY_PATH = resolve(stateDir, "contexts.md");

let cache: TenantEntry[] | null = null;

export function invalidateTenantCache(): void {
  cache = null;
}

function today(): string {
  return dayKeyInTz(new Date(), config.brainTz);
}

function seed(): TenantEntry[] {
  return [
    {
      id: ROOT_TENANT,
      label: "Pessoal",
      parent: null,
      aliases: ["pessoal", "personal"],
      domains: [],
      identifiers: [],
      threads: 0,
      created_at: today(),
      updated_at: today(),
      merged_into: null,
    },
  ];
}

function normalizeEntry(raw: unknown): TenantEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === "string" ? slugify(e.id, 48) : "";
  if (!id) return null;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.trim() !== ""))] : [];
  return {
    id,
    label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : id,
    parent: typeof e.parent === "string" && e.parent ? slugify(e.parent, 48) : null,
    aliases: strings(e.aliases),
    domains: strings(e.domains).map((d) => d.toLowerCase().replace(/^@/, "")),
    identifiers: strings(e.identifiers),
    threads: typeof e.threads === "number" && Number.isFinite(e.threads) ? e.threads : 0,
    created_at: typeof e.created_at === "string" ? e.created_at : today(),
    updated_at: typeof e.updated_at === "string" ? e.updated_at : today(),
    merged_into: typeof e.merged_into === "string" && e.merged_into ? slugify(e.merged_into, 48) : null,
  };
}

async function readRegistry(): Promise<TenantEntry[]> {
  if (cache) return cache;
  if (!existsSync(REGISTRY_PATH)) {
    cache = seed();
    return cache;
  }
  const content = await readFile(REGISTRY_PATH, "utf-8");
  if (!content.trim()) {
    cache = seed();
    return cache;
  }
  let parsed: unknown;
  try {
    parsed = load(content);
  } catch (err) {
    throw new Error(
      `state/contexts.md ilegível (YAML inválido) — corrija antes de continuar: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) throw new Error("state/contexts.md não contém uma lista de contextos");
  const entries = parsed.map(normalizeEntry).filter((e): e is TenantEntry => e !== null);
  cache = entries.length > 0 ? entries : seed();
  return cache;
}

async function writeRegistry(entries: TenantEntry[]): Promise<void> {
  const ordered = [...entries].sort((a, b) => a.id.localeCompare(b.id, "en"));
  await writeFileAtomic(REGISTRY_PATH, dump(ordered, { lineWidth: -1, noRefs: true }));
  cache = ordered;
}

export async function listTenants(): Promise<TenantEntry[]> {
  return [...(await readRegistry())];
}

function follow(entries: TenantEntry[], id: string): string {
  let current = id;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const entry = entries.find((e) => e.id === current);
    if (!entry?.merged_into) return current;
    current = entry.merged_into;
  }
  return current;
}

function rootIn(entries: TenantEntry[], id: string): string {
  let current = follow(entries, id);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const entry = entries.find((e) => e.id === current);
    if (!entry?.parent) return current;
    current = follow(entries, entry.parent);
  }
  return current;
}

/**
 * Contexto ainda não registrado resolve para ele mesmo, nunca para a raiz padrão: cair no
 * default silenciosamente faria um contexto desconhecido passar pela validação de isolamento.
 */
export async function canonicalTenant(id: string): Promise<string> {
  if (!id.trim()) return ROOT_TENANT;
  return follow(await readRegistry(), slugify(id, 48));
}

export async function tenantRoot(id: string): Promise<string> {
  if (!id.trim()) return ROOT_TENANT;
  return rootIn(await readRegistry(), slugify(id, 48));
}

export async function tenantSubtree(id: string): Promise<string[]> {
  const entries = await readRegistry();
  const root = follow(entries, slugify(id || ROOT_TENANT, 48));
  const ids = new Set<string>([root]);
  for (let i = 0; i < MAX_DEPTH; i++) {
    let grew = false;
    for (const entry of entries) {
      if (entry.merged_into) continue;
      if (entry.parent && ids.has(follow(entries, entry.parent)) && !ids.has(entry.id)) {
        ids.add(entry.id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  for (const entry of entries) {
    if (entry.merged_into && ids.has(follow(entries, entry.merged_into))) ids.add(entry.id);
  }
  return [...ids];
}

export async function resolveTenantName(name: string): Promise<string | null> {
  const needle = normalizeForIndex(name);
  if (!needle) return null;
  const entries = await readRegistry();
  const slug = slugify(name, 48);
  const direct = entries.find((e) => e.id === slug);
  if (direct) return follow(entries, direct.id);
  const byAlias = entries.find(
    (e) => normalizeForIndex(e.label) === needle || e.aliases.some((a) => normalizeForIndex(a) === needle),
  );
  return byAlias ? follow(entries, byAlias.id) : null;
}

export async function resolveTenantByHandles(handles: string[]): Promise<string | null> {
  const entries = await readRegistry();
  const domains = handles
    .map((h) => h.toLowerCase().trim())
    .map((h) => (h.includes("@") ? h.slice(h.lastIndexOf("@") + 1) : ""))
    .filter(Boolean);
  if (domains.length === 0) return null;
  for (const entry of entries) {
    if (entry.merged_into) continue;
    if (entry.domains.some((d) => domains.some((h) => h === d || h.endsWith(`.${d}`)))) {
      return follow(entries, entry.id);
    }
  }
  return null;
}

export interface TenantProposal {
  label: string;
  parent?: string | null;
  domains?: string[];
  identifiers?: string[];
}

export async function ensureTenant(proposal: TenantProposal): Promise<string> {
  const label = proposal.label.trim();
  if (!label) return ROOT_TENANT;
  const existing = await resolveTenantName(label);
  if (existing) {
    await noteTenantEvidence(existing, proposal);
    return existing;
  }
  return brainWriteLock(async () => {
    invalidateTenantCache();
    const entries = await readRegistry();
    const slug = slugify(label, 48);
    const already = entries.find((e) => e.id === slug);
    if (already) return follow(entries, already.id);
    const parent = proposal.parent ? await resolveTenantName(proposal.parent) : null;
    const entry: TenantEntry = {
      id: slug,
      label,
      parent: parent && parent !== slug ? parent : null,
      aliases: [label],
      domains: (proposal.domains ?? []).map((d) => d.toLowerCase().replace(/^@/, "")),
      identifiers: proposal.identifiers ?? [],
      threads: 1,
      created_at: today(),
      updated_at: today(),
      merged_into: null,
    };
    await writeRegistry([...entries, entry]);
    return entry.id;
  });
}

export async function noteTenantEvidence(id: string, proposal: TenantProposal): Promise<void> {
  await brainWriteLock(async () => {
    invalidateTenantCache();
    const entries = await readRegistry();
    const canonical = follow(entries, id);
    const entry = entries.find((e) => e.id === canonical);
    if (!entry) return;
    const merged = entries.map((e) =>
      e.id !== canonical
        ? e
        : {
            ...e,
            aliases: [...new Set([...e.aliases, proposal.label].filter(Boolean))],
            domains: [
              ...new Set([...e.domains, ...(proposal.domains ?? []).map((d) => d.toLowerCase().replace(/^@/, ""))]),
            ],
            identifiers: [...new Set([...e.identifiers, ...(proposal.identifiers ?? [])])],
            threads: e.threads + 1,
            updated_at: today(),
          },
    );
    await writeRegistry(merged);
  });
}

export interface MergeResult {
  source: string;
  target: string;
  reparented: string[];
}

export async function mergeTenants(sourceId: string, targetId: string): Promise<MergeResult> {
  return brainWriteLock(async () => {
    invalidateTenantCache();
    const entries = await readRegistry();
    const source = follow(entries, slugify(sourceId, 48));
    const target = follow(entries, slugify(targetId, 48));
    if (source === target) throw new Error("origem e destino são o mesmo contexto");
    if (source === ROOT_TENANT) throw new Error(`o contexto "${ROOT_TENANT}" não pode ser fundido`);
    const from = entries.find((e) => e.id === source);
    const to = entries.find((e) => e.id === target);
    if (!from || !to) throw new Error("contexto não encontrado");
    if (rootIn(entries, target) === source) throw new Error("destino é descendente da origem — fusão criaria ciclo");

    const reparented = entries.filter((e) => e.parent === source && e.id !== source).map((e) => e.id);
    const updated = entries.map((entry) => {
      if (entry.id === source) {
        return { ...entry, merged_into: target, updated_at: today() };
      }
      if (entry.id === target) {
        return {
          ...entry,
          aliases: [...new Set([...entry.aliases, ...from.aliases, from.label])],
          domains: [...new Set([...entry.domains, ...from.domains])],
          identifiers: [...new Set([...entry.identifiers, ...from.identifiers])],
          threads: entry.threads + from.threads,
          updated_at: today(),
        };
      }
      if (entry.parent === source) return { ...entry, parent: target, updated_at: today() };
      return entry;
    });
    await writeRegistry(updated);
    return { source, target, reparented };
  });
}

export async function updateTenant(
  id: string,
  patch: { label?: string; parent?: string | null },
): Promise<TenantEntry> {
  return brainWriteLock(async () => {
    invalidateTenantCache();
    const entries = await readRegistry();
    const canonical = follow(entries, slugify(id, 48));
    const entry = entries.find((e) => e.id === canonical);
    if (!entry) throw new Error("contexto não encontrado");

    let parent = entry.parent;
    if (patch.parent !== undefined) {
      parent = patch.parent ? follow(entries, slugify(patch.parent, 48)) : null;
      if (parent === canonical) throw new Error("um contexto não pode ser pai de si mesmo");
      if (parent && rootIn(entries, parent) === canonical) throw new Error("o novo pai é descendente deste contexto");
      if (parent && !entries.some((e) => e.id === parent)) throw new Error("contexto pai não encontrado");
    }
    const label = patch.label?.trim() || entry.label;
    const updated: TenantEntry = {
      ...entry,
      label,
      parent,
      aliases: [...new Set([...entry.aliases, label])],
      updated_at: today(),
    };
    await writeRegistry(entries.map((e) => (e.id === canonical ? updated : e)));
    return updated;
  });
}

export async function tenantRegistryPrompt(): Promise<string> {
  const entries = (await readRegistry()).filter((e) => !e.merged_into);
  if (entries.length === 0) return "(nenhum contexto registrado ainda)";
  return entries
    .map((e) => {
      const parent = e.parent ? ` · pai: ${e.parent}` : "";
      const domains = e.domains.length > 0 ? ` · domínios: ${e.domains.join(", ")}` : "";
      const identifiers = e.identifiers.length > 0 ? ` · ids: ${e.identifiers.join(", ")}` : "";
      return `- ${e.id} ("${e.label}")${parent}${domains}${identifiers}`;
    })
    .join("\n");
}
