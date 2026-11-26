import { expectedAnswer, exerciseSummary, givenAnswer, stepsOf } from "./exercises.js";
import { DAY_MS, LEECHES_LIMIT, weaknessTitles } from "./learner.js";
import { generateStructured } from "./llm.js";
import { examDaysLeft, mergeProfile, reviewOf } from "./profile.js";
import { teacherSystem } from "./prompts.js";
import { CourseRejection, errorMessage, jobs, withCourseLock, withDiagnosisLock } from "./runtime.js";
import { ANSWER_SCHEMA, DIAGNOSIS_SCHEMA, parseAnswer, parseDiagnosis } from "./schemas.js";
import {
  errorCategories,
  leechWords,
  loadCourse,
  loadLesson,
  recentReviews,
  recentScores,
  saveLesson,
  saveLessonReview,
  saveProfile,
  skillAccuracy,
  vocabularyCounts,
  type CategoryCount,
  type ReviewEntry,
} from "./store.js";
import { diagnosisPrompt, questionPrompt, type AskedQuestion, type DiagnosedExercise } from "./teacher-prompts.js";
import type { LearnerProfile, LessonRecord, Question, StudentInfo } from "./types.js";
import { lessonRole, type ReviewView } from "./views.js";

const DIAGNOSIS_TIMEOUT_MS = 4 * 60_000;
const QUESTION_TIMEOUT_MS = 2 * 60_000;
const STATS_DAYS = 30;
const RECENT_SCORES_LIMIT = 6;
const REVIEWS_LIMIT = 5;
const CONTEXT_CHARS = 4000;

const reviewKey = (lessonId: string) => `review:${lessonId}`;
export const questionKey = (lessonId: string, step: number, position: number) => `ask:${lessonId}:${step}:${position}`;

export interface TeacherOverview {
  profile: LearnerProfile | null;
  reviews: ReviewEntry[];
  categories: CategoryCount[];
  student: StudentInfo;
  examDaysLeft: number | null;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function diagnosedExercises(lesson: LessonRecord): DiagnosedExercise[] {
  return lesson.content.exercises.flatMap((exercise, index) => {
    const result = lesson.progress.results[index];
    if (result?.status !== "graded") return [];
    const open = exercise.type === "translate" || exercise.type === "write";
    return [{
      skill: exercise.skill,
      focus: exercise.focus,
      type: exercise.type,
      prompt: clip(exerciseSummary(exercise), 300),
      answer: clip(givenAnswer(exercise, result.answer), 800),
      verdict: result.verdict ?? "incorrect",
      score: result.score ?? 0,
      expected: clip(open ? result.corrected || exercise.reference : expectedAnswer(exercise), 800),
      notes: (result.notes ?? []).map((note) => `"${note.fragment}" → "${note.correction}" (${note.category})`),
    }];
  });
}

function askedQuestions(lesson: LessonRecord): AskedQuestion[] {
  return Object.entries(lesson.progress.questions).flatMap(([step, questions]) => {
    const label = stepContext(lesson, Number(step))?.label ?? "";
    return questions.map((item) => ({ context: label, question: item.question, answer: clip(item.answer ?? "", 400) }));
  });
}

export function ensureDiagnosis(owner: string, lessonId: string): void {
  jobs.ensure(reviewKey(lessonId), () => withDiagnosisLock(owner, async () => {
    const { course, lesson } = await withCourseLock(owner, async () => ({ course: await loadCourse(owner), lesson: await loadLesson(owner, lessonId) }));
    if (!course?.plan || !lesson || lesson.status !== "completed" || lesson.review) return;
    const now = new Date();
    const since = new Date(now.getTime() - STATS_DAYS * DAY_MS);
    const [skills, categories, scores, vocabulary, leeches] = await Promise.all([
      skillAccuracy(owner, since),
      errorCategories(owner, since),
      recentScores(owner, RECENT_SCORES_LIMIT),
      vocabularyCounts(owner, now),
      leechWords(owner, LEECHES_LIMIT),
    ]);
    const diagnosis = parseDiagnosis(await generateStructured({
      system: teacherSystem(course.student.variant),
      prompt: diagnosisPrompt({
        student: course.student,
        examDaysLeft: examDaysLeft(course.student, now),
        unit: course.plan.units[lesson.unit - 1],
        unitNumber: lesson.unit,
        totalUnits: course.plan.units.length,
        lessonName: lessonRole(lesson),
        lessonTitle: lesson.content.title,
        lessonScore: lesson.score ?? 0,
        lessonsCompleted: course.lessonsCompleted,
        profile: course.profile,
        exercises: diagnosedExercises(lesson),
        questions: askedQuestions(lesson),
        skills,
        categories,
        scores,
        vocabulary,
        leeches,
      }),
      schema: DIAGNOSIS_SCHEMA,
      timeoutMs: DIAGNOSIS_TIMEOUT_MS,
    }));
    await withCourseLock(owner, async () => {
      const latest = await loadCourse(owner);
      const at = new Date();
      await saveProfile(owner, mergeProfile(latest?.profile ?? null, diagnosis, at), at);
      await saveLessonReview(owner, lessonId, reviewOf(diagnosis, at));
    });
  }));
}

export function reviewView(owner: string, lesson: LessonRecord, allowJobs: boolean): ReviewView | null {
  if (lesson.status !== "completed") return null;
  if (lesson.review) {
    const { createdAt: _createdAt, ...review } = lesson.review;
    return { status: "ready", ...review };
  }
  const key = reviewKey(lesson.id);
  if (jobs.isRunning(key)) return { status: "pending" };
  const failure = jobs.failure(key);
  if (failure) return { status: "failed", error: failure };
  if (allowJobs) ensureDiagnosis(owner, lesson.id);
  return { status: "pending" };
}

export function forgetDiagnosis(lessonId: string): void {
  jobs.forget(reviewKey(lessonId));
}

interface StepContext {
  label: string;
  context: string;
  revealAnswer: boolean;
}

export function stepContext(lesson: LessonRecord, position: number): StepContext | null {
  const step = stepsOf(lesson.content)[position];
  if (!step) return null;
  const { content } = lesson;
  switch (step.kind) {
    case "explanation": {
      const examples = content.explanation.examples.map((item) => `${item.es} (${item.pt})`).join("; ");
      return { label: "Explicação", revealAnswer: true, context: clip(`Explicação: ${content.explanation.title}\n${content.explanation.body}\nExemplos: ${examples}`, CONTEXT_CHARS) };
    }
    case "vocabulary": {
      const words = content.vocabulary.map((word) => `${word.display}: ${word.translation}${word.note ? ` (${word.note})` : ""}`).join("\n");
      return { label: "Vocabulário", revealAnswer: true, context: clip(`Palavras novas da aula:\n${words}`, CONTEXT_CHARS) };
    }
    case "reading": {
      const reading = content.reading!;
      const glossary = reading.glossary.map((item) => `${item.es}: ${item.pt}`).join("; ");
      return { label: "Leitura", revealAnswer: true, context: clip(`Texto: ${reading.title}\n${reading.text}\nGlossário: ${glossary}`, CONTEXT_CHARS) };
    }
    case "exercise": {
      const exercise = content.exercises[step.index];
      const result = lesson.progress.results[step.index];
      const graded = result?.status === "graded";
      const lines = [`Exercício ${step.index + 1} (${exercise.type}, ${exercise.skill}).`, `Instrução: ${exercise.instruction}`];
      if (exercise.type === "choice") lines.push(`Frase: ${exercise.prompt}`, `Opções: ${exercise.options.join(" | ")}`);
      if (exercise.type === "fill") lines.push(`Frase: ${exercise.prompt}`, `Dica: ${exercise.hint || "nenhuma"}`);
      if (exercise.type === "translate") lines.push(`Frase em português: ${exercise.source}`);
      if (exercise.type === "write") lines.push(`Tarefa: ${exercise.task}`, `Requisitos: ${exercise.requirements.join("; ") || "nenhum"}`);
      if (graded) {
        lines.push(
          `Resposta do aluno: ${givenAnswer(exercise, result.answer)}`,
          `Resultado: ${result.verdict}`,
          `Resposta esperada: ${expectedAnswer(exercise)}`,
          `Explicação do exercício: ${exercise.explanation}`,
        );
        if (result.feedback) lines.push(`Comentário da correção: ${result.feedback}`);
        if (result.corrected) lines.push(`Versão corrigida: ${result.corrected}`);
      }
      return { label: `Exercício ${step.index + 1}`, revealAnswer: graded, context: clip(lines.join("\n"), CONTEXT_CHARS) };
    }
  }
}

async function updateQuestion(owner: string, lessonId: string, step: number, position: number, change: (question: Question) => boolean): Promise<void> {
  await withCourseLock(owner, async () => {
    const lesson = await loadLesson(owner, lessonId);
    const question = lesson?.progress.questions[step]?.[position];
    if (!lesson || !question) return;
    if (change(question)) await saveLesson(owner, lesson, new Date());
  });
}

export function ensureQuestion(owner: string, lessonId: string, step: number, position: number, fresh: boolean): void {
  const key = questionKey(lessonId, step, position);
  if (fresh) jobs.forget(key);
  jobs.ensure(key, async () => {
    try {
      const { course, lesson } = await withCourseLock(owner, async () => ({ course: await loadCourse(owner), lesson: await loadLesson(owner, lessonId) }));
      const thread = lesson?.progress.questions[step] ?? [];
      const pending = thread[position];
      if (!course?.plan || !lesson || pending?.status !== "pending") return;
      const context = stepContext(lesson, step);
      if (!context) throw new Error("Essa etapa não existe na aula.");
      const answer = parseAnswer(await generateStructured({
        system: teacherSystem(course.student.variant),
        prompt: questionPrompt({
          level: course.plan.units[lesson.unit - 1]?.level ?? "B1",
          lessonTitle: lesson.content.title,
          context: context.context,
          revealAnswer: context.revealAnswer,
          history: thread.slice(0, position).filter((item) => item.status === "answered").map((item) => ({ question: item.question, answer: item.answer ?? "" })),
          weaknesses: weaknessTitles(course),
          question: pending.question,
        }),
        schema: ANSWER_SCHEMA,
        timeoutMs: QUESTION_TIMEOUT_MS,
      }));
      await updateQuestion(owner, lessonId, step, position, (question) => {
        if (question.status !== "pending") return false;
        question.status = "answered";
        question.answer = answer;
        delete question.error;
        return true;
      });
    } catch (error) {
      await updateQuestion(owner, lessonId, step, position, (question) => {
        if (question.status !== "pending") return false;
        question.status = "failed";
        question.error = errorMessage(error);
        return true;
      });
      throw error;
    }
  });
}

export async function teacherOverview(owner: string, now: Date): Promise<TeacherOverview> {
  const course = await loadCourse(owner);
  if (!course?.plan) throw new CourseRejection("no-course");
  const [reviews, categories] = await Promise.all([
    recentReviews(owner, REVIEWS_LIMIT),
    errorCategories(owner, new Date(now.getTime() - STATS_DAYS * DAY_MS)),
  ]);
  return { profile: course.profile, reviews, categories, student: course.student, examDaysLeft: examDaysLeft(course.student, now) };
}
