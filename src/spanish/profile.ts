import { isoDate, isoTimestamp, oneOf, record, slug, str, strings } from "./sanitize.js";
import {
  PACES,
  PRIORITIES,
  SKILLS,
  TRENDS,
  VARIANTS,
  type Diagnosis,
  type LearnerProfile,
  type LessonReview,
  type Priority,
  type Recommendation,
  type ResolvedWeakness,
  type StudentInfo,
  type Weakness,
} from "./types.js";

const DAY_MS = 86_400_000;
const MAX_WEAKNESSES = 8;
const MAX_STRENGTHS = 8;
const MAX_RESOLVED = 20;
const MAX_EXAMPLES = 3;
const PRIORITY_ORDER: Record<Priority, number> = { alta: 0, media: 1, baixa: 2 };

export const DEFAULT_STUDENT: StudentInfo = { goal: "", examDate: null, interests: "", notes: "", variant: "peninsular" };

export function parseStudent(raw: unknown): StudentInfo {
  const student = record(raw);
  return {
    goal: str(student.goal, 300),
    examDate: isoDate(student.examDate),
    interests: str(student.interests, 600),
    notes: str(student.notes, 1500),
    variant: oneOf(student.variant, VARIANTS, DEFAULT_STUDENT.variant),
  };
}

export function examDaysLeft(student: StudentInfo, now: Date): number | null {
  if (!student.examDate) return null;
  const days = Math.ceil((Date.parse(`${student.examDate}T00:00:00Z`) - now.getTime()) / DAY_MS);
  return days >= 0 ? days : null;
}

export function parseWeakness(raw: unknown): Omit<Weakness, "since"> | null {
  const weakness = record(raw);
  const title = str(weakness.title, 160);
  const rule = str(weakness.rule, 800);
  if (!title || !rule) return null;
  const examples = (Array.isArray(weakness.examples) ? weakness.examples : [])
    .map((item) => ({ wrong: str(record(item).wrong, 300), right: str(record(item).right, 300) }))
    .filter((example) => example.wrong && example.right)
    .slice(0, MAX_EXAMPLES);
  return {
    id: slug(str(weakness.id, 80)) || slug(title),
    title,
    skill: oneOf(weakness.skill, SKILLS, "gramatica"),
    rule,
    interference: str(weakness.interference, 600),
    examples,
    priority: oneOf(weakness.priority, PRIORITIES, "media"),
    trend: oneOf(weakness.trend, TRENDS, "persistente"),
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function parseRecommendation(raw: unknown): Recommendation {
  const recommendation = record(raw);
  return { recommended: recommendation.recommended === true, reason: str(recommendation.reason, 600) };
}

export function parseStoredProfile(raw: unknown): LearnerProfile | null {
  const profile = record(raw);
  if (!Array.isArray(profile.weaknesses)) return null;
  const now = new Date().toISOString();
  const weaknesses = profile.weaknesses
    .map((item): Weakness | null => {
      const weakness = parseWeakness(item);
      return weakness ? { ...weakness, since: isoTimestamp(record(item).since, now) } : null;
    })
    .filter((item): item is Weakness => item !== null);
  const resolved = (Array.isArray(profile.resolved) ? profile.resolved : [])
    .map((item): ResolvedWeakness => ({ id: str(record(item).id, 80), title: str(record(item).title, 160), resolvedAt: isoTimestamp(record(item).resolvedAt, now) }))
    .filter((item) => item.id && item.title);
  return {
    weaknesses: uniqueById(weaknesses).slice(0, MAX_WEAKNESSES),
    strengths: strings(profile.strengths, MAX_STRENGTHS, 200),
    resolved: uniqueById(resolved).slice(0, MAX_RESOLVED),
    pace: oneOf(profile.pace, PACES, "manter"),
    guidance: str(profile.guidance, 2000),
    updatedAt: isoTimestamp(profile.updatedAt, now),
    lessonsAnalyzed: Number.isInteger(profile.lessonsAnalyzed) ? profile.lessonsAnalyzed as number : 0,
  };
}

export function parseStoredReview(raw: unknown): LessonReview | null {
  const review = record(raw);
  const comment = str(review.comment, 3000);
  if (!comment) return null;
  return {
    comment,
    reinforcement: parseRecommendation(review.reinforcement),
    pace: oneOf(review.pace, PACES, "manter"),
    createdAt: isoTimestamp(review.createdAt, new Date().toISOString()),
  };
}

export function mergeProfile(previous: LearnerProfile | null, diagnosis: Diagnosis, now: Date): LearnerProfile {
  const at = now.toISOString();
  const before = new Map((previous?.weaknesses ?? []).map((weakness) => [weakness.id, weakness]));
  const resolvedIds = new Set(diagnosis.resolved);
  const current = uniqueById(diagnosis.weaknesses)
    .filter((weakness) => !resolvedIds.has(weakness.id))
    .map((weakness): Weakness => ({ ...weakness, since: before.get(weakness.id)?.since ?? at }));
  const listed = new Set(current.map((weakness) => weakness.id));
  const carried = [...before.values()].filter((weakness) => !listed.has(weakness.id) && !resolvedIds.has(weakness.id));
  const weaknesses = [...current, ...carried]
    .map((weakness, order) => ({ weakness, order }))
    .sort((a, b) => PRIORITY_ORDER[a.weakness.priority] - PRIORITY_ORDER[b.weakness.priority] || a.order - b.order)
    .map(({ weakness }) => weakness)
    .slice(0, MAX_WEAKNESSES);
  const kept = new Set(weaknesses.map((weakness) => weakness.id));
  const newlyResolved = [...before.values()]
    .filter((weakness) => resolvedIds.has(weakness.id) && !kept.has(weakness.id))
    .map((weakness): ResolvedWeakness => ({ id: weakness.id, title: weakness.title, resolvedAt: at }));
  const resolved = uniqueById([...newlyResolved, ...(previous?.resolved ?? [])])
    .filter((item) => !kept.has(item.id))
    .slice(0, MAX_RESOLVED);
  return {
    weaknesses,
    strengths: diagnosis.strengths.slice(0, MAX_STRENGTHS),
    resolved,
    pace: diagnosis.pace,
    guidance: diagnosis.guidance,
    updatedAt: at,
    lessonsAnalyzed: (previous?.lessonsAnalyzed ?? 0) + 1,
  };
}

export function reviewOf(diagnosis: Diagnosis, now: Date): LessonReview {
  return { comment: diagnosis.comment, reinforcement: diagnosis.reinforcement, pace: diagnosis.pace, createdAt: now.toISOString() };
}
