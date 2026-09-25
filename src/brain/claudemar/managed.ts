import { isValidAgentName } from "../../agents/manager.js";
import { isValidProjectName } from "../../session.js";

export const ACTIVITY_SECTION = "Atividade (claudemar)";
export const PIPELINE_SECTION = "Pipeline (claudemar)";

const MANAGED_SECTIONS = new Set([ACTIVITY_SECTION, PIPELINE_SECTION].map((s) => s.toLowerCase()));

export function isManagedSection(name: string): boolean {
  return MANAGED_SECTIONS.has(name.trim().toLowerCase());
}

export const MANAGED_PAGE_RE = /^wiki\/projects\/claudemar-(orquestrador|projeto-[a-z0-9-]+|agente-[a-z0-9-]+)\.md$/;

export const CLAUDEMAR_ACCOUNT = "claudemar";
export const SYSTEM_HANDLE = "claudemar:system";

export type ClaudemarThreadKind = "exec" | "turn" | "card" | "git" | "target";

export function claudemarThreadKind(threadKey: string): ClaudemarThreadKind | null {
  const match = /^cm:(exec|turn|card|git|target):/.exec(threadKey);
  return match ? (match[1] as ClaudemarThreadKind) : null;
}

export type ClaudemarTargetKind = "orchestrator" | "project" | "agent";

export interface ClaudemarTarget {
  kind: ClaudemarTargetKind;
  name: string;
}

export const ORCHESTRATOR_TARGET: ClaudemarTarget = { kind: "orchestrator", name: "orchestrator" };

export function targetKey(target: ClaudemarTarget): string {
  return target.kind === "orchestrator" ? "orchestrator" : `${target.kind}:${target.name}`;
}

export function isValidTargetName(kind: ClaudemarTargetKind, name: string): boolean {
  if (kind === "orchestrator") return name === ORCHESTRATOR_TARGET.name;
  return !name.startsWith(".") && (kind === "project" ? isValidProjectName(name) : isValidAgentName(name));
}

/** Única regra para chaves de alvo: rota, settings, Redis e participantes passam por aqui. */
export function parseTargetKey(key: string): ClaudemarTarget | null {
  if (key === "orchestrator") return ORCHESTRATOR_TARGET;
  const match = /^(project|agent):(.{1,255})$/.exec(key);
  if (!match) return null;
  const target = { kind: match[1] as ClaudemarTargetKind, name: match[2] };
  return isValidTargetName(target.kind, target.name) ? target : null;
}
