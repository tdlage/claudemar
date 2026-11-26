import type { Verdict } from "./types.js";

const DAY_MS = 86_400_000;
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30, 60] as const;
export const TOP_BOX = INTERVAL_DAYS.length - 1;
export const MASTERED_BOX = 4;

export interface ReviewState {
  box: number;
  dueAt: Date;
}

export function review(state: ReviewState, verdict: Verdict, now: Date): ReviewState {
  if (verdict === "incorrect") return { box: 0, dueAt: now };
  if (verdict === "partial") {
    const soon = new Date(now.getTime() + DAY_MS);
    return { box: state.box, dueAt: state.dueAt < soon ? state.dueAt : soon };
  }
  if (state.box > 0 && state.dueAt > now) return state;
  const box = Math.min(TOP_BOX, state.box + 1);
  return { box, dueAt: new Date(now.getTime() + INTERVAL_DAYS[box] * DAY_MS) };
}

export function studyDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function nextStreak(lastDay: string | null, streak: number, today: string): number {
  if (lastDay === today) return Math.max(1, streak);
  return lastDay === previousDay(today) ? streak + 1 : 1;
}

export function currentStreak(lastDay: string | null, streak: number, today: string): number {
  return lastDay === today || lastDay === previousDay(today) ? streak : 0;
}
