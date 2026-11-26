import type { StudentInfo } from "./types";

const PREFIX = "espanol:draft:";

export const STUDENT_DRAFT_KEY = "espanol:student-draft";

export function exerciseDraftKey(lessonId: string, index: number): string {
  return `${PREFIX}${lessonId}:exercise:${index}`;
}

export function questionDraftKey(lessonId: string, step: number): string {
  return `${PREFIX}${lessonId}:question:${step}`;
}

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(key: string, text: string): void {
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    return;
  }
}

export function readStudentDraft(): StudentInfo | null {
  const raw = readDraft(STUDENT_DRAFT_KEY);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<StudentInfo>;
    return {
      goal: typeof draft.goal === "string" ? draft.goal : "",
      examDate: typeof draft.examDate === "string" && draft.examDate ? draft.examDate : null,
      interests: typeof draft.interests === "string" ? draft.interests : "",
      notes: typeof draft.notes === "string" ? draft.notes : "",
      variant: draft.variant === "americana" ? "americana" : "peninsular",
    };
  } catch {
    return null;
  }
}

export function clearLessonDrafts(lessonId: string): void {
  try {
    const prefix = `${PREFIX}${lessonId}:`;
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => key?.startsWith(prefix) ?? false);
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    return;
  }
}
