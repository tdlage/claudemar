import { errorsOf } from "./errors.js";
import { exerciseSummary, expectedAnswer, givenAnswer, scoreOf } from "./exercises.js";
import { countWords } from "./grading.js";
import { generateStructured } from "./llm.js";
import { teacherSystem } from "./prompts.js";
import { errorMessage, jobs, withCourseLock } from "./runtime.js";
import { APPEAL_SCHEMA, ASSESSMENT_SCHEMA, parseAppeal, parseAssessment } from "./schemas.js";
import { deleteAttemptErrors, insertErrors, loadLesson, recordAttempt, reviewWords, saveLesson, updateAttemptScore } from "./store.js";
import { appealPrompt, assessmentPrompt } from "./teacher-prompts.js";
import type { CefrLevel, Exercise, ExerciseResult, LessonRecord, Variant } from "./types.js";

const ASSESSMENT_TIMEOUT_MS = 3 * 60_000;
const APPEAL_TIMEOUT_MS = 2 * 60_000;

export const assessmentKey = (lessonId: string, index: number) => `assess:${lessonId}:${index}`;
export const appealKey = (lessonId: string, index: number) => `appeal:${lessonId}:${index}`;

export interface CorrectionContext {
  owner: string;
  level: CefrLevel;
  variant: Variant;
  weaknesses: string[];
}

export function canAppeal(exercise: Exercise, result: ExerciseResult): boolean {
  return exercise.type === "fill" && result.status === "graded" && result.verdict !== "correct"
    && (result.appeal === undefined || result.appeal === "failed");
}

export async function recordGrade(owner: string, lessonId: string, index: number, exercise: Exercise, result: ExerciseResult, now: Date): Promise<number> {
  const open = exercise.type === "translate" || exercise.type === "write";
  const attemptId = await recordAttempt(owner, {
    lessonId,
    index,
    skill: exercise.skill,
    focus: exercise.focus,
    prompt: exerciseSummary(exercise),
    answer: givenAnswer(exercise, result.answer),
    expected: open ? result.corrected || exercise.reference : expectedAnswer(exercise),
    score: result.score ?? 0,
  }, now);
  await insertErrors(owner, { lessonId, index, attemptId }, errorsOf(exercise, result), now);
  await reviewWords(owner, exercise.lemmas, result.verdict ?? "incorrect", now);
  return attemptId;
}

async function updateResult(owner: string, lessonId: string, index: number, change: (lesson: LessonRecord, result: ExerciseResult) => Promise<boolean>): Promise<void> {
  await withCourseLock(owner, async () => {
    const lesson = await loadLesson(owner, lessonId);
    const result = lesson?.progress.results[index];
    if (!lesson || !result) return;
    if (await change(lesson, result)) await saveLesson(owner, lesson, new Date());
  });
}

export function ensureAssessment(ctx: CorrectionContext, lesson: LessonRecord, index: number, fresh: boolean): void {
  const exercise = lesson.content.exercises[index];
  const result = lesson.progress.results[index];
  if (!exercise || (exercise.type !== "translate" && exercise.type !== "write") || result?.status !== "grading") return;
  const answer = String(result.answer);
  const key = assessmentKey(lesson.id, index);
  if (fresh) jobs.forget(key);
  jobs.ensure(key, async () => {
    try {
      const assessment = parseAssessment(await generateStructured({
        system: teacherSystem(ctx.variant),
        prompt: assessmentPrompt(exercise, ctx.level, answer, countWords(answer), ctx.weaknesses),
        schema: ASSESSMENT_SCHEMA,
        timeoutMs: ASSESSMENT_TIMEOUT_MS,
      }));
      await updateResult(ctx.owner, lesson.id, index, async (current, pending) => {
        if (pending.status !== "grading" || pending.answer !== answer) return false;
        const graded: ExerciseResult = { answer, status: "graded", ...assessment };
        graded.attemptId = await recordGrade(ctx.owner, current.id, index, exercise, graded, new Date());
        current.progress.results[index] = graded;
        return true;
      });
    } catch (error) {
      await updateResult(ctx.owner, lesson.id, index, async (current, pending) => {
        if (pending.status !== "grading" || pending.answer !== answer) return false;
        current.progress.results[index] = { answer, status: "failed", error: errorMessage(error) };
        return true;
      });
      throw error;
    }
  });
}

export function ensureAppeal(ctx: CorrectionContext, lesson: LessonRecord, index: number, fresh: boolean): void {
  const exercise = lesson.content.exercises[index];
  const result = lesson.progress.results[index];
  if (exercise?.type !== "fill" || result?.appeal !== "pending") return;
  const answer = String(result.answer);
  const key = appealKey(lesson.id, index);
  if (fresh) jobs.forget(key);
  jobs.ensure(key, async () => {
    try {
      const decision = parseAppeal(await generateStructured({
        system: teacherSystem(ctx.variant),
        prompt: appealPrompt(exercise, answer),
        schema: APPEAL_SCHEMA,
        timeoutMs: APPEAL_TIMEOUT_MS,
      }));
      await updateResult(ctx.owner, lesson.id, index, async (current, pending) => {
        if (pending.appeal !== "pending") return false;
        pending.appeal = decision.accepted ? "accepted" : "rejected";
        pending.appealNote = decision.explanation;
        if (decision.accepted) {
          pending.verdict = "correct";
          pending.score = 1;
          delete pending.feedback;
          if (pending.attemptId) {
            await updateAttemptScore(ctx.owner, pending.attemptId, 1);
            await deleteAttemptErrors(ctx.owner, pending.attemptId);
          }
          await reviewWords(ctx.owner, exercise.lemmas, "correct", new Date());
        }
        if (current.status === "completed") current.score = scoreOf(current);
        return true;
      });
    } catch (error) {
      await updateResult(ctx.owner, lesson.id, index, async (_current, pending) => {
        if (pending.appeal !== "pending") return false;
        pending.appeal = "failed";
        pending.appealNote = errorMessage(error);
        return true;
      });
      throw error;
    }
  });
}
