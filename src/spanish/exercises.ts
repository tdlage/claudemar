import type { Exercise, LessonContent, LessonRecord } from "./types.js";

export type Step = { kind: "explanation" } | { kind: "vocabulary" } | { kind: "reading" } | { kind: "exercise"; index: number };

export function stepsOf(content: LessonContent): Step[] {
  return [
    { kind: "explanation" },
    ...(content.vocabulary.length > 0 ? [{ kind: "vocabulary" } as const] : []),
    ...(content.reading ? [{ kind: "reading" } as const] : []),
    ...content.exercises.map((_, index) => ({ kind: "exercise", index }) as const),
  ];
}

export function expectedAnswer(exercise: Exercise): string {
  switch (exercise.type) {
    case "choice": return exercise.options[exercise.answer];
    case "fill": return exercise.answers.join(" / ");
    default: return exercise.reference;
  }
}

export function exerciseSummary(exercise: Exercise): string {
  switch (exercise.type) {
    case "choice":
    case "fill": return exercise.prompt;
    case "translate": return exercise.source;
    case "write": return exercise.task;
  }
}

export function givenAnswer(exercise: Exercise, answer: string | number): string {
  return exercise.type === "choice" && typeof answer === "number" ? exercise.options[answer] ?? "" : String(answer);
}

export function scoreOf(lesson: LessonRecord): number {
  const scores = lesson.content.exercises.map((_, index) => lesson.progress.results[index]?.score ?? 0);
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 1000) / 1000;
}
