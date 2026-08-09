import type { BrainRetrievalSettings, WikiPageType } from "./types.js";

export const DEFAULT_TYPE_WEIGHTS: Record<WikiPageType, number> = {
  lesson: 1.35,
  procedure: 1.35,
  person: 1.3,
  org: 1.3,
  decision: 1.25,
  project: 1.2,
  topic: 1.0,
  thread: 0.85,
};

export const DEFAULT_HALF_LIFE_DAYS: Record<WikiPageType, number | null> = {
  thread: 180,
  person: 365,
  org: 365,
  project: 365,
  topic: 365,
  lesson: null,
  procedure: null,
  decision: null,
};

export const DEFAULT_SALIENCE_BONUS = 0.1;

export interface Rankable {
  type: WikiPageType;
  status: "active" | "dormant" | "archived";
  pinned: boolean;
  salience: number;
  updatedAt: string;
  retrievalCount: number;
  helpfulCount: number;
}

const DAY_MS = 86_400_000;

export function recencyWeight(
  payload: Pick<Rankable, "type" | "status" | "updatedAt">,
  halfLifeDays: Record<WikiPageType, number | null>,
  nowMs: number,
): number {
  if (payload.type === "project" && payload.status === "active") return 1;
  const halfLife = halfLifeDays[payload.type];
  if (halfLife === null || halfLife === undefined) return 1;
  const ageMs = nowMs - Date.parse(payload.updatedAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  if (halfLife <= 0) return 0;
  return Math.pow(0.5, ageMs / (halfLife * DAY_MS));
}

export function utilityWeight(payload: Pick<Rankable, "retrievalCount" | "helpfulCount">): number {
  return 0.5 + (payload.helpfulCount + 1) / (payload.retrievalCount + 2);
}

export function businessScore(
  rerankScore: number,
  payload: Rankable,
  settings: BrainRetrievalSettings,
  nowMs: number,
): number {
  const typeWeight = settings.typeWeights[payload.type] ?? 1;
  const salience = Math.min(1, Math.max(0, payload.salience));
  return (
    rerankScore *
    recencyWeight(payload, settings.halfLifeDays, nowMs) *
    typeWeight *
    (1 + settings.salienceBonus * salience) *
    utilityWeight(payload)
  );
}

export function passesThreshold(rerankScore: number | null, pinned: boolean, minScore: number): boolean {
  if (pinned || minScore <= 0) return true;
  return rerankScore === null || rerankScore >= minScore;
}
