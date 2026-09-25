import type { RowDataPacket } from "mysql2/promise";
import { query } from "../../database.js";
import type { StageArtifacts } from "../../pipeline-manager.js";
import { hash8, sha256Hex } from "../text.js";
import type { CanonicalEvent, CanonicalParticipant } from "../types.js";
import { clipMiddle } from "./execution-events.js";
import { CLAUDEMAR_ACCOUNT } from "./managed.js";
import { targetHandle, targetLabel, type ClaudemarTarget } from "./targets.js";

export interface PipelineCard {
  id: string;
  seq: number;
  title: string;
  projectName: string;
  stage: string;
  status: string;
  originType: string;
  originRef: string | null;
  intakeInput: string;
  requirement: string;
  plan: string;
  lastFeedback: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  runs: { id: string; stage: string; attempt: number; status: string; execId: string | null; finishedAt: string | null; artifacts: StageArtifacts }[];
  repos: { name: string; branch: string | null; prUrl: string | null; prNumber: number | null; status: string }[];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toISOString();
  return new Date(0).toISOString();
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export async function loadPipelineCards(): Promise<PipelineCard[]> {
  const cards = await query<RowDataPacket[]>(
    `SELECT c.id, c.seq_number, c.title, c.stage, c.status, c.origin_type, c.origin_ref, c.intake_input,
            c.requirement_text, c.plan_markdown, c.last_feedback, c.created_by, c.created_at, c.updated_at,
            p.project_name
     FROM pipeline_cards c JOIN pipeline_pipelines p ON p.id = c.pipeline_id`,
  );
  const runs = groupBy(
    await query<RowDataPacket[]>(
      `SELECT id, card_id, stage, attempt, exec_id, status, artifacts, finished_at
       FROM pipeline_stage_runs WHERE status <> 'running' ORDER BY started_at ASC`,
    ),
    (r) => String(r.card_id),
  );
  const repos = groupBy(
    await query<RowDataPacket[]>("SELECT card_id, repo_name, branch, pr_url, pr_number, repo_status FROM pipeline_card_repos"),
    (r) => String(r.card_id),
  );
  return cards.map((r) => ({
    id: String(r.id),
    seq: Number(r.seq_number ?? 0),
    title: text(r.title),
    projectName: text(r.project_name),
    stage: text(r.stage),
    status: text(r.status),
    originType: text(r.origin_type),
    originRef: r.origin_ref ? String(r.origin_ref) : null,
    intakeInput: text(r.intake_input),
    requirement: text(r.requirement_text),
    plan: text(r.plan_markdown),
    lastFeedback: text(r.last_feedback),
    createdBy: text(r.created_by),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    runs: (runs.get(String(r.id)) ?? []).map((run) => ({
      id: String(run.id),
      stage: text(run.stage),
      attempt: Number(run.attempt ?? 1),
      status: text(run.status),
      execId: run.exec_id ? String(run.exec_id) : null,
      finishedAt: run.finished_at ? iso(run.finished_at) : null,
      artifacts: json<StageArtifacts>(run.artifacts, {}),
    })),
    repos: (repos.get(String(r.id)) ?? []).map((repo) => ({
      name: text(repo.repo_name),
      branch: repo.branch ? String(repo.branch) : null,
      prUrl: repo.pr_url ? String(repo.pr_url) : null,
      prNumber: repo.pr_number === null || repo.pr_number === undefined ? null : Number(repo.pr_number),
      status: text(repo.repo_status),
    })),
  }));
}

export function cardStatus(card: PipelineCard): string {
  return `${card.stage}/${card.status}`;
}

export function cardFingerprint(card: PipelineCard): string {
  return sha256Hex(
    JSON.stringify([
      card.title,
      cardStatus(card),
      card.requirement,
      card.plan,
      card.lastFeedback,
      card.runs.map((r) => `${r.id}:${r.status}`),
      card.repos.map((r) => `${r.name}:${r.prNumber}:${r.status}`),
    ]),
  ).slice(0, 16);
}

function participants(target: ClaudemarTarget, author: string): CanonicalParticipant[] {
  return [
    { name: targetLabel(target), handle: targetHandle(target), role: "agent" },
    { name: author || "usuário", handle: `claudemar:user:${author || "usuario"}`, role: "from" },
  ];
}

function artifactSummary(artifacts: StageArtifacts): string {
  const parts: string[] = [];
  if (artifacts.tests) parts.push(`testes: ${artifacts.tests.passed ? "passaram" : "falharam"} (${artifacts.tests.total - artifacts.tests.failed}/${artifacts.tests.total})`);
  if (artifacts.review) {
    parts.push(`revisão: ${artifacts.review.totalFindings} achado(s), ${artifacts.review.fixed} corrigido(s)${artifacts.review.clean ? ", limpa" : ""}`);
    if (artifacts.review.summary) parts.push(`resumo da revisão: ${artifacts.review.summary}`);
  }
  if (artifacts.e2e) parts.push(`e2e: ${artifacts.e2e.passed ? "passou" : "falhou"}`);
  if (artifacts.prs?.length) parts.push(`PRs: ${artifacts.prs.map((pr) => pr.url).join(", ")}`);
  if (artifacts.items?.length) parts.push(`itens de intake: ${artifacts.items.map((i) => i.title).join("; ")}`);
  return parts.join("\n");
}

export function cardThreadKey(cardId: string): string {
  return `cm:card:${cardId}`;
}

export function cardEvents(card: PipelineCard, target: ClaudemarTarget, opts: { statusChanged: boolean }): CanonicalEvent[] {
  const threadKey = cardThreadKey(card.id);
  const base = {
    channel: "claudemar" as const,
    subchannel: "direct" as const,
    account: CLAUDEMAR_ACCOUNT,
    thread_key: threadKey,
    subject: `[pipeline ${card.projectName} #${card.seq}] ${card.title}`,
    attachments: [],
    raw_ref: `pipeline:${card.id}`,
  };
  const events: CanonicalEvent[] = [
    {
      ...base,
      external_id: `${threadKey}:created`,
      occurred_at: card.createdAt,
      participants: participants(target, card.createdBy),
      body_text: clipMiddle(
        `Card #${card.seq} do pipeline de ${card.projectName}: "${card.title}" — origem ${card.originType}${card.originRef ? ` (${card.originRef})` : ""}, criado por ${card.createdBy || "desconhecido"}.${card.intakeInput ? `\n\nEntrada:\n${card.intakeInput}` : ""}`,
      ),
    },
  ];
  if (card.requirement.trim()) {
    events.push({
      ...base,
      external_id: `${threadKey}:requirement:${hash8(card.requirement)}`,
      occurred_at: card.updatedAt,
      participants: participants(target, "pipeline"),
      body_text: clipMiddle(`Requisito do card #${card.seq}:\n\n${card.requirement}`),
    });
  }
  if (card.plan.trim()) {
    events.push({
      ...base,
      external_id: `${threadKey}:plan:${hash8(card.plan)}`,
      occurred_at: card.updatedAt,
      participants: participants(target, "pipeline"),
      body_text: clipMiddle(`Plano do card #${card.seq}:\n\n${card.plan}`),
    });
  }
  for (const run of card.runs) {
    const summary = artifactSummary(run.artifacts);
    events.push({
      ...base,
      external_id: `${threadKey}:run:${run.id}:${run.status}`,
      occurred_at: run.finishedAt ?? card.updatedAt,
      participants: participants(target, "pipeline"),
      body_text: `Estágio ${run.stage} (tentativa ${run.attempt}) terminou com status ${run.status}${run.execId ? ` — execução ${run.execId}` : ""}.${summary ? `\n${summary}` : ""}`,
    });
  }
  for (const repo of card.repos.filter((r) => r.prUrl)) {
    events.push({
      ...base,
      external_id: `${threadKey}:pr:${repo.name}:${repo.prNumber ?? 0}:${repo.status}`,
      occurred_at: card.updatedAt,
      participants: participants(target, "pipeline"),
      body_text: `PR ${repo.prUrl} (${repo.status}) no repositório ${repo.name}${repo.branch ? `, branch ${repo.branch}` : ""}.`,
    });
  }
  if (opts.statusChanged) {
    events.push({
      ...base,
      external_id: `${threadKey}:state:${hash8(cardStatus(card))}:${Date.parse(card.updatedAt)}`,
      occurred_at: card.updatedAt,
      participants: participants(target, "pipeline"),
      body_text: `Card #${card.seq} agora no estágio ${card.stage} com status ${card.status}.${card.lastFeedback ? `\nÚltimo feedback: ${card.lastFeedback}` : ""}`,
    });
  }
  return events;
}

const OPEN_LIMIT = 30;
const DONE_LIMIT = 10;

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cardLine(card: PipelineCard): string {
  const prs = card.repos.filter((r) => r.prUrl).map((r) => `${r.prUrl} (${r.status})`);
  return `- #${card.seq} · ${singleLine(card.title)} — estágio ${card.stage} · ${card.status} · atualizado ${card.updatedAt.slice(0, 10)}${prs.length > 0 ? ` · PR ${prs.join(", ")}` : ""}`;
}

export function renderPipelineSection(target: ClaudemarTarget, cards: PipelineCard[]): string {
  const own = target.kind === "project" ? cards.filter((c) => c.projectName === target.name) : [];
  if (own.length === 0) return "Nenhum card do pipeline associado a este alvo.";
  const byRecent = (a: PipelineCard, b: PipelineCard) => b.updatedAt.localeCompare(a.updatedAt);
  const open = own.filter((c) => c.status !== "done").sort(byRecent);
  const done = own.filter((c) => c.status === "done").sort(byRecent);
  const parts: string[] = [];
  if (open.length > 0) {
    parts.push(`**Em aberto** (${open.length})`, ...open.slice(0, OPEN_LIMIT).map(cardLine));
    if (open.length > OPEN_LIMIT) parts.push(`- … e mais ${open.length - OPEN_LIMIT}`);
    parts.push("");
  }
  if (done.length > 0) {
    parts.push(`**Concluídos** (${done.length})`, ...done.slice(0, DONE_LIMIT).map(cardLine));
    if (done.length > DONE_LIMIT) parts.push(`- … e mais ${done.length - DONE_LIMIT}`);
  }
  return `Cards do pipeline deste projeto (gerado automaticamente).\n\n${parts.join("\n").trim()}`;
}
