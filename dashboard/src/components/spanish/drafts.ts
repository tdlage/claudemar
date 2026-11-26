const PREFIX = "espanol:draft:";

function draftKey(lessonId: string, index: number): string {
  return `${PREFIX}${lessonId}:${index}`;
}

export function readDraft(lessonId: string, index: number): string {
  try {
    return localStorage.getItem(draftKey(lessonId, index)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(lessonId: string, index: number, text: string): void {
  try {
    if (text) localStorage.setItem(draftKey(lessonId, index), text);
    else localStorage.removeItem(draftKey(lessonId, index));
  } catch {
    return;
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
