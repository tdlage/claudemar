import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { config } from "../../config.js";
import { summarizeTargetHistory } from "../../history.js";
import { parseWikiFrontmatterLoose } from "../frontmatter.js";
import { findThreadPath, readThread } from "../raw-store.js";
import { brainKeys, getRedis } from "../redis.js";
import type { BrainScope } from "../scope.js";
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
import { brainSettings } from "../settings.js";
import { claudemarAccess } from "./access.js";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];
const MAX_INSTRUCTION_CHARS = 8000;
const MAX_INSTRUCTION_FILE_BYTES = 512 * 1024;
const RECENT_EXECUTIONS = 12;
const RECENT_COMMITS = 10;

export function targetContextThreadKey(target: ClaudemarTarget): string {
  return `cm:target:${targetKey(target)}`;
}

export async function cachedThreadPath(scope: BrainScope, threadKey: string): Promise<string | null> {
  const path = await getRedis().hget(brainKeys(scope).threadFile, threadKey).catch(() => null);
  return path && existsSync(resolve(scope.root, path)) ? path : null;
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

/** Para um usuário o contexto do alvo é só a identificação: instruções, diretório e remotos são da instalação. */
export async function targetContextEvent(scope: BrainScope, target: ClaudemarTarget): Promise<CanonicalEvent> {
  const access = claudemarAccess(scope);
  const root = targetRoot(target);
  const present = existsSync(root);
  const repos = present && access.instructions ? await targetRepos(target) : [];
  const instructions = present && access.instructions ? await instructionsOf(target, repos.map((r) => r.path)) : null;
  const redact = await createRedactor();
  const lines = [`${targetLabel(target)} no claudemar.`];
  if (access.instructions) lines.push(`Diretório: ${root}${present ? "" : " (não existe mais no disco)"}`);
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

export async function ensureTargetPage(scope: BrainScope, target: ClaudemarTarget, sourcePath: string): Promise<boolean> {
  const relPath = targetPagePath(target);
  if (isTargetExcluded(scope, target) || existsSync(resolve(scope.root, relPath))) return false;
  const tenant = await targetTenant(scope, target);
  const aliases = target.kind === "orchestrator"
    ? ["orquestrador", "orchestrator", targetHandle(target)]
    : [target.name, targetKey(target), targetHandle(target)];
  await createWikiPage(scope, {
    relPath,
    type: "project",
    slug: relPath.split("/").pop()!.replace(/\.md$/, ""),
    title: `${targetLabel(target)} (claudemar)`,
    tenant,
    tenantRoot: await tenantRoot(scope, tenant),
    aliases,
    sections: [
      {
        section: "Contexto",
        content: scope.isAdmin
          ? `${targetLabel(target)} do claudemar, diretório ${targetRoot(target)}.`
          : `${targetLabel(target)} do claudemar.`,
      },
      { section: "Estado atual", content: "" },
      { section: "Decisões", content: "" },
      { section: "Histórico", content: "" },
      { section: "Pendências", content: "" },
      { section: "Links", content: "" },
    ],
    sources: [sourcePath],
    containsPii: 0,
  });
  scheduleIndexRegeneration(scope);
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

async function renderActivitySection(scope: BrainScope, target: ClaudemarTarget, redact: Redactor): Promise<string> {
  const access = claudemarAccess(scope);
  const summary = await summarizeTargetHistory(
    access.history,
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
      const path = await cachedThreadPath(scope, executionThreadKey(entry.id));
      lines.push(
        `- ${day(entry.startedAt)} · ${entry.runtime ?? "?"} · ${entry.status} — "${oneLine(maskPersonalData(redact(entry.prompt)), 110)}"${path ? ` → ${path}` : ""}`,
      );
    }
  }
  const commits = access.commits(target) ? await recentCommits(target, RECENT_COMMITS).catch(() => []) : [];
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

function pipelineSectionText(scope: BrainScope, target: ClaudemarTarget, cards: PipelineCard[] | null, redact: Redactor): string {
  if (target.kind !== "project") return renderPipelineSection(target, []);
  if (!claudemarAccess(scope).cards(target)) return "Sem acesso ao pipeline deste projeto.";
  return cards
    ? redact(renderPipelineSection(target, cards))
    : "Sincronização dos cards do pipeline desligada nas configurações do Second Brain.";
}

export async function syncTargetPage(
  scope: BrainScope,
  target: ClaudemarTarget,
  cards: PipelineCard[] | null,
): Promise<PageSyncResult> {
  const identity = await findThreadPath(scope, targetContextThreadKey(target), "claudemar");
  if (!identity) return "waiting";
  const created = await ensureTargetPage(scope, target, identity);
  const tenant = await targetTenant(scope, target);
  const redact = await createRedactor();
  const changed = await upsertManagedSections(
    scope,
    targetPagePath(target),
    [
      { name: ACTIVITY_SECTION, content: redact(await renderActivitySection(scope, target, redact)) },
      { name: PIPELINE_SECTION, content: pipelineSectionText(scope, target, cards, redact) },
    ],
    { tenant, tenantRoot: await tenantRoot(scope, tenant) },
  );
  if (changed) scheduleIndexRegeneration(scope);
  return created ? "created" : changed ? "updated" : "unchanged";
}

/**
 * Após mudar o contexto de um alvo, leva junto as páginas cuja evidência vem só dele — senão as
 * próximas compilações do alvo seriam rejeitadas por tocar páginas de outra árvore de contexto.
 */
export async function retenantTargetPages(scope: BrainScope, target: ClaudemarTarget): Promise<number> {
  const tenant = await targetTenant(scope, target);
  const root = await tenantRoot(scope, tenant);
  const key = targetKey(target);
  const owned = new Map<string, boolean>();
  const ownedByTarget = async (source: string): Promise<boolean> => {
    if (!source.startsWith("raw/claudemar/")) return false;
    if (!owned.has(source)) {
      const thread = await readThread(scope, source);
      const owner = thread ? targetFromParticipants(thread.frontmatter.participants) : null;
      owned.set(source, owner !== null && targetKey(owner) === key);
    }
    return owned.get(source)!;
  };
  let changed = 0;
  for (const dir of WIKI_DIRS) {
    const files = (await readdir(resolve(scope.wikiDir, dir)).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const relPath = `wiki/${dir}/${file}`;
      const { data } = parseWikiFrontmatterLoose(await readFile(resolve(scope.root, relPath), "utf-8").catch(() => ""));
      const sources = Array.isArray(data.sources) ? data.sources.filter((v): v is string => typeof v === "string") : [];
      if (sources.length === 0) continue;
      let all = true;
      for (const source of sources) {
        if (!(await ownedByTarget(source))) {
          all = false;
          break;
        }
      }
      if (all && (await setPageTenant(scope, relPath, tenant, root))) changed += 1;
    }
  }
  if (changed > 0) scheduleIndexRegeneration(scope);
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

export async function describeTarget(scope: BrainScope, target: ClaudemarTarget): Promise<ClaudemarTargetInfo> {
  const key = targetKey(target);
  const pagePath = targetPagePath(target);
  return {
    key,
    kind: target.kind,
    name: target.name,
    label: targetLabel(target),
    tenant: await targetTenant(scope, target),
    mappedTenant: brainSettings(scope).get().claudemar.tenants[key] ?? null,
    excluded: isTargetExcluded(scope, target),
    pagePath,
    pageExists: existsSync(resolve(scope.root, pagePath)),
  };
}

/** Só os alvos que o dono pode ver; o admin também vê alvos apagados que ainda aparecem nas próprias configurações. */
export async function describeTargets(scope: BrainScope): Promise<ClaudemarTargetInfo[]> {
  const access = claudemarAccess(scope);
  const byKey = new Map(access.targets.map((t) => [targetKey(t), t]));
  if (scope.isAdmin) {
    const settings = brainSettings(scope).get().claudemar;
    for (const key of [...Object.keys(settings.tenants), ...settings.excludedTargets]) {
      const target = parseTargetKey(key);
      if (target && !byKey.has(key)) byKey.set(key, target);
    }
  }
  return Promise.all([...byKey.values()].map((target) => describeTarget(scope, target)));
}
