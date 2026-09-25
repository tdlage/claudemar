import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { config } from "../../config.js";
import { summarizeTargetHistory } from "../../history.js";
import { brainRoot, wikiDir } from "../paths.js";
import { parseWikiFrontmatterLoose } from "../frontmatter.js";
import { findThreadPath, readThread } from "../raw-store.js";
import { getRedis, KEYS } from "../redis.js";
import { tenantRoot } from "../tenants.js";
import { dayKeyInTz, sha256Hex } from "../text.js";
import {
  WIKI_DIRS,
  createWikiPage,
  scheduleIndexRegeneration,
  setPageTenant,
  upsertManagedSections,
} from "../wiki.js";
import type { CanonicalEvent } from "../types.js";
import { recentCommits, targetRepos } from "./commits.js";
import { clipMiddle, executionThreadKey } from "./execution-events.js";
import { ACTIVITY_SECTION, CLAUDEMAR_ACCOUNT, PIPELINE_SECTION, SYSTEM_HANDLE } from "./managed.js";
import { renderPipelineSection, type PipelineCard } from "./pipeline.js";
import { createRedactor, maskPersonalData, type Redactor } from "./redact.js";
import {
  isTargetExcluded,
  listTargets,
  parseTargetKey,
  targetFromParticipants,
  targetHandle,
  targetKey,
  targetLabel,
  targetPagePath,
  targetRoot,
  targetTenant,
  type ClaudemarTarget,
} from "./targets.js";
import { brainSettingsManager } from "../settings.js";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];
const MAX_INSTRUCTION_CHARS = 8000;
const MAX_INSTRUCTION_FILE_BYTES = 512 * 1024;
const RECENT_EXECUTIONS = 12;
const RECENT_COMMITS = 10;

export function targetContextThreadKey(target: ClaudemarTarget): string {
  return `cm:target:${targetKey(target)}`;
}

export async function cachedThreadPath(threadKey: string): Promise<string | null> {
  const path = await getRedis().hget(KEYS.threadFile, threadKey).catch(() => null);
  return path && existsSync(resolve(brainRoot, path)) ? path : null;
}

/** Instruções só de arquivos comuns dentro do próprio alvo: um symlink num repo clonado poderia apontar para qualquer arquivo do host. */
export async function instructionsOf(target: ClaudemarTarget, repoPaths: string[]): Promise<{ file: string; content: string } | null> {
  const root = await realpath(targetRoot(target)).catch(() => null);
  if (!root) return null;
  for (const dir of [root, ...repoPaths.filter((p) => p !== root)]) {
    for (const name of INSTRUCTION_FILES) {
      const path = resolve(dir, name);
      const info = await lstat(path).catch(() => null);
      if (!info?.isFile() || info.size > MAX_INSTRUCTION_FILE_BYTES) continue;
      const real = await realpath(path).catch(() => null);
      if (!real || !real.startsWith(root + sep)) continue;
      const content = (await readFile(real, "utf-8").catch(() => "")).trim();
      if (content) return { file: relative(root, real) || name, content };
    }
  }
  return null;
}

export async function targetContextEvent(target: ClaudemarTarget): Promise<CanonicalEvent> {
  const root = targetRoot(target);
  const present = existsSync(root);
  const repos = present ? await targetRepos(target) : [];
  const instructions = present ? await instructionsOf(target, repos.map((r) => r.path)) : null;
  const redact = await createRedactor();
  const lines = [
    `${targetLabel(target)} no claudemar.`,
    `Diretório: ${root}${present ? "" : " (não existe mais no disco)"}`,
  ];
  if (repos.length > 0) {
    lines.push(
      "",
      "Repositórios:",
      ...repos.map((r) => `- ${r.name === "." ? "raiz" : r.name}${r.remoteUrl ? `: remoto ${r.remoteUrl}` : ""}`),
    );
  }
  if (instructions) {
    lines.push("", `Instruções (${instructions.file}):`, clipMiddle(redact(instructions.content), MAX_INSTRUCTION_CHARS));
  }
  const body = lines.join("\n");
  const threadKey = targetContextThreadKey(target);
  return {
    channel: "claudemar",
    subchannel: "direct",
    account: CLAUDEMAR_ACCOUNT,
    external_id: `${threadKey}:${sha256Hex(body).slice(0, 12)}`,
    thread_key: threadKey,
    occurred_at: new Date().toISOString(),
    participants: [
      { name: targetLabel(target), handle: targetHandle(target), role: "agent" },
      { name: "claudemar", handle: SYSTEM_HANDLE, role: "from" },
    ],
    subject: `${targetLabel(target)} — contexto no claudemar`,
    body_text: body,
    attachments: [],
    raw_ref: `target:${targetKey(target)}`,
  };
}

export async function ensureTargetPage(target: ClaudemarTarget, sourcePath: string): Promise<boolean> {
  const relPath = targetPagePath(target);
  if (isTargetExcluded(target) || existsSync(resolve(brainRoot, relPath))) return false;
  const tenant = await targetTenant(target);
  const aliases = target.kind === "orchestrator"
    ? ["orquestrador", "orchestrator", targetHandle(target)]
    : [target.name, targetKey(target), targetHandle(target)];
  await createWikiPage({
    relPath,
    type: "project",
    slug: relPath.split("/").pop()!.replace(/\.md$/, ""),
    title: `${targetLabel(target)} (claudemar)`,
    tenant,
    tenantRoot: await tenantRoot(tenant),
    aliases,
    sections: [
      { section: "Contexto", content: `${targetLabel(target)} do claudemar, diretório ${targetRoot(target)}.` },
      { section: "Estado atual", content: "" },
      { section: "Decisões", content: "" },
      { section: "Histórico", content: "" },
      { section: "Pendências", content: "" },
      { section: "Links", content: "" },
    ],
    sources: [sourcePath],
    containsPii: 0,
  });
  scheduleIndexRegeneration();
  return true;
}

function day(iso: string): string {
  return dayKeyInTz(new Date(iso), config.brainTz);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function counts(record: Record<string, number>): string {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

async function renderActivitySection(target: ClaudemarTarget, redact: Redactor): Promise<string> {
  const summary = await summarizeTargetHistory(
    target.kind,
    target.kind === "orchestrator" ? null : target.name,
    RECENT_EXECUTIONS,
  );
  const lines = ["Resumo gerado automaticamente a partir do histórico de execuções e dos repositórios do claudemar.", ""];
  if (summary.executions === 0) {
    lines.push("- Nenhuma execução registrada no histórico.");
  } else {
    lines.push(
      `- Execuções: ${summary.executions} em ${summary.sessions} sessão(ões) (${counts(summary.byRuntime)}) · de ${day(summary.firstAt!)} a ${day(summary.lastAt!)}`,
      `- Status: ${counts(summary.byStatus)}`,
    );
    if (summary.costUsd > 0) lines.push(`- Custo registrado: US$ ${summary.costUsd.toFixed(2)}`);
    lines.push("", "Últimas execuções:");
    for (const entry of summary.recent) {
      const path = await cachedThreadPath(executionThreadKey(entry.id));
      lines.push(
        `- ${day(entry.startedAt)} · ${entry.runtime ?? "?"} · ${entry.status} — "${oneLine(maskPersonalData(redact(entry.prompt)), 110)}"${path ? ` → ${path}` : ""}`,
      );
    }
  }
  const commits = await recentCommits(target, RECENT_COMMITS).catch(() => []);
  if (commits.length > 0) {
    lines.push(
      "",
      "Commits recentes:",
      ...commits.map((c) => `- ${day(c.authoredAt)} · ${c.repo}@${c.hash.slice(0, 8)} — ${oneLine(maskPersonalData(redact(c.message)).split("\n")[0], 110)}`),
    );
  }
  return lines.join("\n");
}

export type PageSyncResult = "waiting" | "created" | "updated" | "unchanged";

export async function syncTargetPage(
  target: ClaudemarTarget,
  cards: PipelineCard[] | null,
): Promise<PageSyncResult> {
  const identity = await findThreadPath(targetContextThreadKey(target), "claudemar");
  if (!identity) return "waiting";
  const created = await ensureTargetPage(target, identity);
  const tenant = await targetTenant(target);
  const redact = await createRedactor();
  const changed = await upsertManagedSections(
    targetPagePath(target),
    [
      { name: ACTIVITY_SECTION, content: redact(await renderActivitySection(target, redact)) },
      {
        name: PIPELINE_SECTION,
        content: cards
          ? redact(renderPipelineSection(target, cards))
          : "Sincronização dos cards do pipeline desligada nas configurações do Second Brain.",
      },
    ],
    { tenant, tenantRoot: await tenantRoot(tenant) },
  );
  if (changed) scheduleIndexRegeneration();
  return created ? "created" : changed ? "updated" : "unchanged";
}

/**
 * Após mudar o contexto de um alvo, leva junto as páginas cuja evidência vem só dele — senão as
 * próximas compilações do alvo seriam rejeitadas por tocar páginas de outra árvore de contexto.
 */
export async function retenantTargetPages(target: ClaudemarTarget): Promise<number> {
  const tenant = await targetTenant(target);
  const root = await tenantRoot(tenant);
  const key = targetKey(target);
  const owned = new Map<string, boolean>();
  const ownedByTarget = async (source: string): Promise<boolean> => {
    if (!source.startsWith("raw/claudemar/")) return false;
    if (!owned.has(source)) {
      const thread = await readThread(source);
      const owner = thread ? targetFromParticipants(thread.frontmatter.participants) : null;
      owned.set(source, owner !== null && targetKey(owner) === key);
    }
    return owned.get(source)!;
  };
  let changed = 0;
  for (const dir of WIKI_DIRS) {
    const files = (await readdir(resolve(wikiDir, dir)).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const relPath = `wiki/${dir}/${file}`;
      const { data } = parseWikiFrontmatterLoose(await readFile(resolve(brainRoot, relPath), "utf-8").catch(() => ""));
      const sources = Array.isArray(data.sources) ? data.sources.filter((v): v is string => typeof v === "string") : [];
      if (sources.length === 0) continue;
      let all = true;
      for (const source of sources) {
        if (!(await ownedByTarget(source))) {
          all = false;
          break;
        }
      }
      if (all && (await setPageTenant(relPath, tenant, root))) changed += 1;
    }
  }
  if (changed > 0) scheduleIndexRegeneration();
  return changed;
}

export interface ClaudemarTargetInfo {
  key: string;
  kind: ClaudemarTarget["kind"];
  name: string;
  label: string;
  tenant: string;
  mappedTenant: string | null;
  excluded: boolean;
  pagePath: string;
  pageExists: boolean;
}

export async function describeTarget(target: ClaudemarTarget): Promise<ClaudemarTargetInfo> {
  const key = targetKey(target);
  const pagePath = targetPagePath(target);
  return {
    key,
    kind: target.kind,
    name: target.name,
    label: targetLabel(target),
    tenant: await targetTenant(target),
    mappedTenant: brainSettingsManager.get().claudemar.tenants[key] ?? null,
    excluded: isTargetExcluded(target),
    pagePath,
    pageExists: existsSync(resolve(brainRoot, pagePath)),
  };
}

export async function describeTargets(): Promise<ClaudemarTargetInfo[]> {
  const settings = brainSettingsManager.get().claudemar;
  const byKey = new Map(listTargets().map((t) => [targetKey(t), t]));
  for (const key of [...Object.keys(settings.tenants), ...settings.excludedTargets]) {
    const target = parseTargetKey(key);
    if (target && !byKey.has(key)) byKey.set(key, target);
  }
  return Promise.all([...byKey.values()].map(describeTarget));
}
