import { examDaysLeft } from "./profile.js";
import { dueWords, knownLemmas, leechWords, recentErrors, recentLessonTitles, vocabularyCounts, weakFocuses } from "./store.js";
import type { CourseRecord, LearnerSnapshot } from "./types.js";

export const DAY_MS = 86_400_000;
const KNOWN_LEMMAS_LIMIT = 1500;
const DUE_WORDS_LIMIT = 12;
export const LEECHES_LIMIT = 8;
const WEAK_FOCUS_LIMIT = 6;
const WEAK_FOCUS_DAYS = 60;
const RECENT_ERRORS_LIMIT = 10;
const RECENT_TITLES_LIMIT = 6;

export async function learnerSnapshot(owner: string, course: CourseRecord, now: Date): Promise<LearnerSnapshot> {
  const [known, vocabulary, due, leeches, weak, errors, titles] = await Promise.all([
    knownLemmas(owner, KNOWN_LEMMAS_LIMIT),
    vocabularyCounts(owner, now),
    dueWords(owner, now, DUE_WORDS_LIMIT),
    leechWords(owner, LEECHES_LIMIT),
    weakFocuses(owner, new Date(now.getTime() - WEAK_FOCUS_DAYS * DAY_MS), WEAK_FOCUS_LIMIT),
    recentErrors(owner, RECENT_ERRORS_LIMIT),
    recentLessonTitles(owner, RECENT_TITLES_LIMIT),
  ]);
  return {
    student: course.student,
    profile: course.profile,
    knownLemmas: known,
    vocabulary,
    dueWords: due,
    leeches,
    weakFocuses: weak,
    recentErrors: errors,
    recentTitles: titles,
    examDaysLeft: examDaysLeft(course.student, now),
  };
}

export function weaknessTitles(course: CourseRecord): string[] {
  return course.profile?.weaknesses.map((weakness) => weakness.title) ?? [];
}
