import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { parseWikiFrontmatterLoose } from "./frontmatter.js";
import { brainRoot, resolveInside } from "./paths.js";
import { brainSettingsManager } from "./settings.js";
import { sha256Hex, slugify } from "./text.js";
import { candidateCount, noteCandidates } from "./entities.js";
import {
  TYPE_DIRS,
  addRelation,
  appendHistory,
  appendLog,
  appendOpenLoops,
  createWikiPage,
  markPagePii,
  markSuperseded,
  scheduleIndexRegeneration,
  upsertSection,
} from "./wiki.js";
import { markCompiledInto } from "./raw-store.js";
import type { CompileOperation, CompileOutput, RawFrontmatter } from "./types.js";

const tenantSchema = z.enum(["personal", "biosoft"]);
const pageTypeSchema = z.enum(["person", "org", "project", "topic", "thread", "lesson", "procedure", "decision"]);

const createPageSchema = z.object({
  op: z.literal("create_page"),
  path: z.string(),
  page_type: pageTypeSchema,
  title: z.string().min(1),
  tenant: tenantSchema,
  aliases: z.array(z.string()),
  sections: z.array(z.object({ section: z.string().min(1), content: z.string() })).min(1),
  sources: z.array(z.string()).min(1),
});

const upsertSectionSchema = z.object({
  op: z.literal("upsert_section"),
  path: z.string(),
  section: z.string().min(1),
  content: z.string().min(1),
  sources: z.array(z.string()).min(1),
});

const appendHistorySchema = z.object({
  op: z.literal("append_history"),
  path: z.string(),
  content: z.string().min(1),
  sources: z.array(z.string()).min(1),
});

const addRelationSchema = z.object({
  op: z.literal("add_relation"),
  path: z.string(),
  related: z.string().min(1),
  sources: z.array(z.string()).min(1),
});

const markSupersededSchema = z.object({
  op: z.literal("mark_superseded"),
  path: z.string(),
  superseded_by: z.string().nullable(),
  reason: z.string().min(1),
  sources: z.array(z.string()).min(1),
});

const operationSchema = z.discriminatedUnion("op", [
  createPageSchema,
  upsertSectionSchema,
  appendHistorySchema,
  addRelationSchema,
  markSupersededSchema,
]);

const openLoopSchema = z.object({
  title: z.string().min(1),
  tenant: tenantSchema,
  kind: z.enum(["my_commitment", "waiting_on", "decision_pending"]),
  counterparty: z.string(),
  due: z.string().nullable(),
  next_action: z.string(),
  supersedes: z.string().nullable(),
  sources: z.array(z.string()),
});

export const compileOutputSchema = z.object({
  operations: z.array(operationSchema),
  open_loops: z.array(openLoopSchema),
  log_entry: z.string(),
  new_entities: z.array(z.object({ type: pageTypeSchema, slug: z.string(), title: z.string() })),
});

const stringArray = { type: "array", items: { type: "string" } };
const sourcesRequired = { type: "array", items: { type: "string" }, minItems: 1 };
const tenantEnum = { type: "string", enum: ["personal", "biosoft"] };
const pageTypeEnum = {
  type: "string",
  enum: ["person", "org", "project", "topic", "thread", "lesson", "procedure", "decision"],
};

export const COMPILE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["operations", "open_loops", "log_entry", "new_entities"],
  properties: {
    operations: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "path", "page_type", "title", "tenant", "aliases", "sections", "sources"],
            properties: {
              op: { type: "string", enum: ["create_page"] },
              path: { type: "string" },
              page_type: pageTypeEnum,
              title: { type: "string" },
              tenant: tenantEnum,
              aliases: stringArray,
              sections: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["section", "content"],
                  properties: { section: { type: "string" }, content: { type: "string" } },
                },
              },
              sources: sourcesRequired,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "path", "section", "content", "sources"],
            properties: {
              op: { type: "string", enum: ["upsert_section"] },
              path: { type: "string" },
              section: { type: "string" },
              content: { type: "string" },
              sources: sourcesRequired,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "path", "content", "sources"],
            properties: {
              op: { type: "string", enum: ["append_history"] },
              path: { type: "string" },
              content: { type: "string" },
              sources: sourcesRequired,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "path", "related", "sources"],
            properties: {
              op: { type: "string", enum: ["add_relation"] },
              path: { type: "string" },
              related: { type: "string" },
              sources: sourcesRequired,
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["op", "path", "superseded_by", "reason", "sources"],
            properties: {
              op: { type: "string", enum: ["mark_superseded"] },
              path: { type: "string" },
              superseded_by: { type: ["string", "null"] },
              reason: { type: "string" },
              sources: sourcesRequired,
            },
          },
        ],
      },
    },
    open_loops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "tenant", "kind", "counterparty", "due", "next_action", "supersedes", "sources"],
        properties: {
          title: { type: "string" },
          tenant: tenantEnum,
          kind: { type: "string", enum: ["my_commitment", "waiting_on", "decision_pending"] },
          counterparty: { type: "string" },
          due: { type: ["string", "null"] },
          next_action: { type: "string" },
          supersedes: { type: ["string", "null"] },
          sources: stringArray,
        },
      },
    },
    log_entry: { type: "string" },
    new_entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "slug", "title"],
        properties: { type: pageTypeEnum, slug: { type: "string" }, title: { type: "string" } },
      },
    },
  },
};

export function computeDocKey(threadKey: string, op: CompileOperation): string {
  const discriminator =
    op.op === "upsert_section"
      ? op.section
      : op.op === "append_history"
        ? op.content
        : op.op === "add_relation"
          ? op.related
          : op.op === "mark_superseded"
            ? op.reason
            : op.title;
  return sha256Hex(`${threadKey}|${op.path}|${op.op}|${discriminator}`).slice(0, 16);
}

function validPagePath(path: string): boolean {
  if (!path.startsWith("wiki/") || !path.endsWith(".md")) return false;
  if (!resolveInside(brainRoot, path)) return false;
  const parts = path.split("/");
  return parts.length === 3 && Object.values(TYPE_DIRS).includes(parts[1]);
}

function sourceExists(source: string): boolean {
  if (!source.startsWith("raw/")) return false;
  const abs = resolveInside(brainRoot, source);
  return Boolean(abs && existsSync(abs));
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export async function validateCompileOutput(
  output: CompileOutput,
  thread: RawFrontmatter,
): Promise<ValidationResult> {
  const settings = brainSettingsManager.get();
  const errors: string[] = [];
  const threadTenant = thread.triage?.tenant ?? (thread.tenant === "biosoft" ? "biosoft" : "personal");
  const isGroup = thread.subchannel === "group";

  for (const [i, op] of output.operations.entries()) {
    const label = `operations[${i}] (${op.op})`;
    if (!validPagePath(op.path)) {
      errors.push(`${label}: path "${op.path}" fora do padrão wiki/<tipo>/<slug>.md`);
      continue;
    }
    for (const source of op.sources) {
      if (!sourceExists(source)) errors.push(`${label}: source "${source}" não existe em raw/`);
    }

    if (op.op === "create_page") {
      const expectedDir = TYPE_DIRS[op.page_type];
      if (op.path.split("/")[1] !== expectedDir) {
        errors.push(`${label}: página do tipo ${op.page_type} deve ficar em wiki/${expectedDir}/`);
      }
      if (op.tenant !== threadTenant) {
        errors.push(`${label}: tenant "${op.tenant}" difere do tenant da thread ("${threadTenant}")`);
      }
      if (isGroup && ["decision", "procedure", "lesson"].includes(op.page_type)) {
        errors.push(`${label}: thread de grupo não pode gerar página do tipo ${op.page_type}`);
      }
      const totalChars = op.sections.reduce((acc, s) => acc + s.content.length, 0);
      if (totalChars > settings.compile.maxSectionChars * op.sections.length) {
        errors.push(`${label}: conteúdo excede o limite de ${settings.compile.maxSectionChars} chars por seção`);
      }
      for (const section of op.sections) {
        if (section.content.length > settings.compile.maxSectionChars) {
          errors.push(`${label}: seção "${section.section}" excede ${settings.compile.maxSectionChars} chars`);
        }
      }
      if (existsSync(resolve(brainRoot, op.path))) {
        errors.push(`${label}: página "${op.path}" já existe — use upsert_section`);
      } else if (thread.triage?.relevance !== 3) {
        const seen = await candidateCount(op.title);
        if (seen < 3) {
          errors.push(
            `${label}: criação de página exige entidade vista em ≥3 threads (visto ${seen}x) ou relevance 3`,
          );
        }
      }
    }

    if (op.op !== "create_page") {
      const createdInBatch = output.operations.some(
        (other) => other.op === "create_page" && other.path === op.path,
      );
      const abs = resolve(brainRoot, op.path);
      if (!createdInBatch && existsSync(abs)) {
        const { data } = parseWikiFrontmatterLoose(await readFile(abs, "utf-8"));
        if (data.tenant !== threadTenant) {
          errors.push(
            `${label}: página alvo é do tenant "${String(data.tenant)}", diferente da thread ("${threadTenant}")`,
          );
        }
        if (isGroup && ["decision", "procedure", "lesson"].includes(String(data.type))) {
          errors.push(`${label}: thread de grupo não pode alterar página do tipo ${String(data.type)}`);
        }
      }
    }

    if (op.op === "upsert_section" || op.op === "append_history") {
      if (op.content.length > settings.compile.maxSectionChars) {
        errors.push(`${label}: conteúdo excede ${settings.compile.maxSectionChars} chars`);
      }
      const isCreate = output.operations.some((other) => other.op === "create_page" && other.path === op.path);
      if (!isCreate && !existsSync(resolve(brainRoot, op.path))) {
        errors.push(`${label}: página "${op.path}" não existe`);
      }
    }

    if (op.op === "add_relation" || op.op === "mark_superseded") {
      if (!existsSync(resolve(brainRoot, op.path))) {
        errors.push(`${label}: página "${op.path}" não existe`);
      }
    }
  }

  for (const [i, loop] of output.open_loops.entries()) {
    if (isGroup) {
      errors.push(`open_loops[${i}]: thread de grupo não gera open-loop`);
      continue;
    }
    if (loop.tenant !== threadTenant) {
      errors.push(`open_loops[${i}]: tenant "${loop.tenant}" difere do tenant da thread ("${threadTenant}")`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export interface ApplyResult {
  pages: string[];
  openLoops: number;
}

export async function applyCompileOutput(
  threadKey: string,
  rawRelPath: string,
  output: CompileOutput,
  containsPii: 0 | 1 = 0,
): Promise<ApplyResult> {
  const touched = new Set<string>();
  const threadSources = [rawRelPath];
  const ordered = [
    ...output.operations.filter((op) => op.op === "create_page"),
    ...output.operations.filter((op) => op.op !== "create_page"),
  ];

  for (const op of ordered) {
    const docKey = computeDocKey(threadKey, op);
    if (op.op === "create_page") {
      await createWikiPage({
        relPath: op.path,
        type: op.page_type,
        slug: slugify(op.path.split("/").pop()!.replace(/\.md$/, ""), 60),
        title: op.title,
        tenant: op.tenant,
        aliases: op.aliases,
        sections: op.sections,
        sources: op.sources,
        containsPii,
      });
      touched.add(op.path);
    } else if (op.op === "upsert_section") {
      if (await upsertSection(op.path, op.section, op.content, op.sources)) touched.add(op.path);
    } else if (op.op === "append_history") {
      if (await appendHistory(op.path, op.content, op.sources, docKey)) touched.add(op.path);
    } else if (op.op === "add_relation") {
      if (await addRelation(op.path, op.related)) touched.add(op.path);
    } else if (op.op === "mark_superseded") {
      if (await markSuperseded(op.path, op.superseded_by, op.reason, docKey)) touched.add(op.path);
    }
  }

  const openLoops = await appendOpenLoops(output.open_loops, threadSources, threadKey);
  if (openLoops > 0) touched.add("state/open-loops.md");

  if (output.log_entry.trim()) {
    await appendLog(output.log_entry, sha256Hex(`${threadKey}|log|${output.log_entry}`).slice(0, 16));
  }
  if (output.new_entities.length > 0) {
    await noteCandidates(output.new_entities.map((e) => e.title));
  }
  if (containsPii === 1) {
    for (const path of touched) {
      if (path.startsWith("wiki/")) await markPagePii(path);
    }
  }
  if (touched.size > 0) {
    scheduleIndexRegeneration();
    await markCompiledInto(rawRelPath, [...touched]);
  }
  return { pages: [...touched], openLoops };
}
