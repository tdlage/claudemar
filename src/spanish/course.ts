import { keyedLock } from "../keyed-lock.js";
import { countWords, gradeChoice, gradeFill, type LocalGrade } from "./grading.js";
import { generateStructured } from "./llm.js";
import {
  appealPrompt,
  assessmentPrompt,
  expectedAnswer,
  exerciseSummary,
  LESSON_ROLES,
  lessonPrompt,
  planPrompt,
  TEACHER_SYSTEM,
  type LearnerSnapshot,
} from "./prompts.js";
import { APPEAL_SCHEMA, ASSESSMENT_SCHEMA, LESSON_SCHEMA, parseAppeal, parseAssessment, parseLesson, parsePlan, PLAN_SCHEMA } from "./schemas.js";
import { currentStreak, nextStreak, studyDay } from "./srs.js";
import {
  addWords,
  completedSlots,
  createCourse,
  dueWords,
  findOpenLesson,
  insertLesson,
  knownLemmas,
  listVocabulary,
  loadCourse,
  loadLesson,
  recentLessonTitles,
  recentMistakes,
  recordAttempt,
  reviewWords,
  saveCourse,
  saveLesson,
  savePlan,
  skillAccuracy,
  updateAttemptScore,
  vocabularyCounts,
  weakFocuses,
  type SkillAccuracy,
  type SlotSummary,
  type StoredWord,
  type VocabularyCounts,
} from "./store.js";
import {
  LESSONS_PER_UNIT,
  type CefrLevel,
  type CourseRecord,
  type CourseUnit,
  type Exercise,
  type ExerciseResult,
  type Explanation,
  type LessonContent,
  type LessonRecord,
  type Reading,
  type Slot,
  type VocabularyEntry,
} from "./types.js";

const PLAN_TIMEOUT_MS = 10 * 60_000;
const LESSON_TIMEOUT_MS = 8 * 60_000;
const ASSESSMENT_TIMEOUT_MS = 3 * 60_000;
const APPEAL_TIMEOUT_MS = 2 * 60_000;
const GENERATION_ATTEMPTS = 2;
const MAX_LESSON_JOBS = 3;
const MAX_ANSWER_CHARS = 4000;
const KNOWN_LEMMAS_LIMIT = 1500;
const DUE_WORDS_LIMIT = 12;
const WEAK_FOCUS_LIMIT = 6;
const WEAK_FOCUS_DAYS = 60;
const MISTAKES_LIMIT = 12;
const RECENT_TITLES_LIMIT = 6;
const DAY_MS = 86_400_000;

export type Rejection = "no-course" | "out-of-sync" | "invalid-answer" | "locked-lesson" | "not-ready" | "course-finished";

export class CourseRejection extends Error {
  constructor(readonly reason: Rejection) {
    super(reason);
  }
}

class Jobs {
  private readonly running = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();

  ensure(key: string, task: () => Promise<void>): void {
    if (this.running.has(key) || this.failures.has(key)) return;
    const run = task()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.failures.set(key, message);
        console.error(`[spanish] ${key}: ${message}`);
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, run);
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  runningWith(prefix: string): number {
    return [...this.running.keys()].filter((key) => key.startsWith(prefix)).length;
  }

  failure(key: string): string | null {
    return this.failures.get(key) ?? null;
  }

  forget(key: string): void {
    this.failures.delete(key);
  }
}

const jobs = new Jobs();
const withCourseLock = keyedLock();

type Step = { kind: "explanation" } | { kind: "vocabulary" } | { kind: "reading" } | { kind: "exercise"; index: number };

export interface ResultView extends Omit<ExerciseResult, "attemptId"> {
  expected: string;
  explanation: string;
  correctOption: number | null;
  canAppeal: boolean;
}

export interface ExerciseView {
  index: number;
  type: Exercise["type"];
  skill: Exercise["skill"];
  focus: string;
  instruction: string;
  prompt: string | null;
  options: string[] | null;
  hint: string | null;
  source: string | null;
  task: string | null;
  requirements: string[] | null;
  minWords: number | null;
  maxWords: number | null;
  result: ResultView | null;
}

export type StepView =
  | ({ kind: "explanation" } & Explanation)
  | { kind: "vocabulary"; words: VocabularyEntry[] }
  | ({ kind: "reading" } & Reading)
  | { kind: "exercise"; exercise: ExerciseView };

export interface LessonView {
  id: string;
  unit: number;
  step: number;
  role: string;
  title: string;
  goal: string;
  cursor: number;
  completed: boolean;
  score: number | null;
  steps: StepView[];
}

export interface CourseSummary {
  current: Slot;
  furthest: Slot;
  totalUnits: number;
  lessonsPerUnit: number;
  unit: Pick<CourseUnit, "level" | "titleEs" | "titlePt" | "theme">;
  lessonsCompleted: number;
  streakDays: number;
  vocabulary: VocabularyCounts;
}

export interface NextView {
  slot: Slot;
  ready: boolean;
  error: string | null;
}

export type CourseStatus = "welcome" | "preparing-course" | "preparing-lesson" | "lesson";

export interface CourseState {
  status: CourseStatus;
  error: string | null;
  course: CourseSummary | null;
  lesson: LessonView | null;
  next: NextView | null;
}

export interface UnitOverview extends CourseUnit {
  number: number;
  lessons: (SlotSummary | null)[];
  unlocked: boolean;
}

export interface CourseOverview {
  current: Slot;
  furthest: Slot;
  roles: string[];
  units: UnitOverview[];
  skills: SkillAccuracy[];
  weakFocuses: Awaited<ReturnType<typeof weakFocuses>>;
  vocabulary: VocabularyCounts;
}

export interface VocabularyOverview {
  counts: VocabularyCounts;
  words: StoredWord[];
}

export interface Context {
  owner: string;
  allowJobs: boolean;
  timeZone: string;
  now: Date;
}

const planKey = (owner: string) => `plan:${owner}`;
const lessonPrefix = (owner: string) => `lesson:${owner}:`;
const lessonKey = (owner: string, slot: Slot) => `${lessonPrefix(owner)}${slot.unit}:${slot.step}`;
const assessmentKey = (lessonId: string, index: number) => `assess:${lessonId}:${index}`;
const appealKey = (lessonId: string, index: number) => `appeal:${lessonId}:${index}`;

function slotIndex(slot: Slot): number {
  return (slot.unit - 1) * LESSONS_PER_UNIT + (slot.step - 1);
}

function sameSlot(a: Slot, b: Slot): boolean {
  return a.unit === b.unit && a.step === b.step;
}

function nextSlot(slot: Slot, totalUnits: number): Slot | null {
  if (slot.step < LESSONS_PER_UNIT) return { unit: slot.unit, step: slot.step + 1 };
  return slot.unit < totalUnits ? { unit: slot.unit + 1, step: 1 } : null;
}

function stepsOf(content: LessonContent): Step[] {
  return [
    { kind: "explanation" },
    ...(content.vocabulary.length > 0 ? [{ kind: "vocabulary" } as const] : []),
    ...(content.reading ? [{ kind: "reading" } as const] : []),
    ...content.exercises.map((_, index) => ({ kind: "exercise", index }) as const),
  ];
}

function levelOf(course: CourseRecord, unit: number): CefrLevel {
  return course.plan?.units[unit - 1]?.level ?? "B1";
}

function canAppeal(exercise: Exercise, result: ExerciseResult): boolean {
  return exercise.type === "fill" && result.status === "graded" && result.verdict !== "correct"
    && (result.appeal === undefined || result.appeal === "failed");
}

function resultView(exercise: Exercise, result: ExerciseResult): ResultView {
  const { attemptId: _attemptId, ...visible } = result;
  const graded = result.status === "graded";
  return {
    ...visible,
    expected: graded ? expectedAnswer(exercise) : "",
    explanation: graded ? exercise.explanation : "",
    correctOption: graded && exercise.type === "choice" ? exercise.answer : null,
    canAppeal: canAppeal(exercise, result),
  };
}

function exerciseView(exercise: Exercise, index: number, result: ExerciseResult | undefined): ExerciseView {
  return {
    index,
    type: exercise.type,
    skill: exercise.skill,
    focus: result?.status === "graded" ? exercise.focus : "",
    instruction: exercise.instruction,
    prompt: exercise.type === "choice" || exercise.type === "fill" ? exercise.prompt : null,
    options: exercise.type === "choice" ? exercise.options : null,
    hint: exercise.type === "fill" ? exercise.hint : null,
    source: exercise.type === "translate" ? exercise.source : null,
    task: exercise.type === "write" ? exercise.task : null,
    requirements: exercise.type === "write" ? exercise.requirements : null,
    minWords: exercise.type === "write" ? exercise.minWords : null,
    maxWords: exercise.type === "write" ? exercise.maxWords : null,
    result: result ? resultView(exercise, result) : null,
  };
}

function lessonView(lesson: LessonRecord): LessonView {
  const { content } = lesson;
  const steps = stepsOf(content).map((step): StepView => {
    switch (step.kind) {
      case "explanation": return { kind: "explanation", ...content.explanation };
      case "vocabulary": return { kind: "vocabulary", words: content.vocabulary };
      case "reading": return { kind: "reading", ...content.reading! };
      case "exercise": return { kind: "exercise", exercise: exerciseView(content.exercises[step.index], step.index, lesson.progress.results[step.index]) };
    }
  });
  return {
    id: lesson.id,
    unit: lesson.unit,
    step: lesson.step,
    role: LESSON_ROLES[lesson.step - 1]?.name ?? "",
    title: content.title,
    goal: content.goal,
    cursor: lesson.progress.cursor,
    completed: lesson.status === "completed",
    score: lesson.score,
    steps,
  };
}

function lessonScore(lesson: LessonRecord): number {
  const scores = lesson.content.exercises.map((_, index) => lesson.progress.results[index]?.score ?? 0);
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 1000) / 1000;
}

async function learnerSnapshot(owner: string, now: Date): Promise<LearnerSnapshot> {
  const [known, counts, due, weak, mistakes, titles] = await Promise.all([
    knownLemmas(owner, KNOWN_LEMMAS_LIMIT),
    vocabularyCounts(owner, now),
    dueWords(owner, now, DUE_WORDS_LIMIT),
    weakFocuses(owner, new Date(now.getTime() - WEAK_FOCUS_DAYS * DAY_MS), WEAK_FOCUS_LIMIT),
    recentMistakes(owner, MISTAKES_LIMIT),
    recentLessonTitles(owner, RECENT_TITLES_LIMIT),
  ]);
  return { knownLemmas: known, knownCount: counts.total, masteredCount: counts.mastered, dueWords: due, weakFocuses: weak, mistakes, recentTitles: titles };
}

async function withAttempts<T>(produce: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    try {
      return await produce();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function ensureLessonJob(owner: string, slot: Slot, prefetch: boolean): void {
  const key = lessonKey(owner, slot);
  if (jobs.isRunning(key)) return;
  if (jobs.runningWith(lessonPrefix(owner)) >= (prefetch ? 1 : MAX_LESSON_JOBS)) return;
  jobs.ensure(key, async () => {
    if (await findOpenLesson(owner, slot)) return;
    const course = await loadCourse(owner);
    if (!course?.plan) throw new Error("O plano do curso ainda não existe.");
    const plan = course.plan;
    const learner = await learnerSnapshot(owner, new Date());
    const known = new Set(learner.knownLemmas);
    const content = await withAttempts(async () => parseLesson(await generateStructured({
      system: TEACHER_SYSTEM,
      prompt: lessonPrompt(plan, slot.unit, slot.step, learner),
      schema: LESSON_SCHEMA,
      timeoutMs: LESSON_TIMEOUT_MS,
    })));
    await insertLesson(owner, slot, { ...content, vocabulary: content.vocabulary.filter((word) => !known.has(word.lemma)) }, new Date());
  });
}

function ensurePlanJob(owner: string): void {
  jobs.ensure(planKey(owner), async () => {
    const plan = await withAttempts(async () => parsePlan(await generateStructured({
      system: TEACHER_SYSTEM,
      prompt: planPrompt(),
      schema: PLAN_SCHEMA,
      timeoutMs: PLAN_TIMEOUT_MS,
    })));
    await savePlan(owner, plan, new Date());
    ensureLessonJob(owner, { unit: 1, step: 1 }, false);
  });
}

async function updateResult(owner: string, lessonId: string, index: number, change: (lesson: LessonRecord, result: ExerciseResult) => Promise<boolean>): Promise<void> {
  await withCourseLock(owner, async () => {
    const lesson = await loadLesson(owner, lessonId);
    const result = lesson?.progress.results[index];
    if (!lesson || !result) return;
    if (await change(lesson, result)) await saveLesson(owner, lesson, new Date());
  });
}

function ensureAssessment(owner: string, lesson: LessonRecord, index: number, level: CefrLevel, fresh: boolean): void {
  const exercise = lesson.content.exercises[index];
  const result = lesson.progress.results[index];
  if (!exercise || (exercise.type !== "translate" && exercise.type !== "write") || result?.status !== "grading") return;
  const answer = String(result.answer);
  const key = assessmentKey(lesson.id, index);
  if (fresh) jobs.forget(key);
  jobs.ensure(key, async () => {
    try {
      const assessment = parseAssessment(await generateStructured({
        system: TEACHER_SYSTEM,
        prompt: assessmentPrompt(exercise, level, answer, countWords(answer)),
        schema: ASSESSMENT_SCHEMA,
        timeoutMs: ASSESSMENT_TIMEOUT_MS,
      }));
      await updateResult(owner, lesson.id, index, async (current, pending) => {
        if (pending.status !== "grading" || pending.answer !== answer) return false;
        const now = new Date();
        const attemptId = await recordAttempt(owner, {
          lessonId: current.id, index, skill: exercise.skill, focus: exercise.focus,
          prompt: exerciseSummary(exercise), answer, expected: assessment.corrected || exercise.reference, score: assessment.score,
        }, now);
        await reviewWords(owner, exercise.lemmas, assessment.verdict, now);
        current.progress.results[index] = { answer, status: "graded", attemptId, ...assessment };
        return true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateResult(owner, lesson.id, index, async (current, pending) => {
        if (pending.status !== "grading" || pending.answer !== answer) return false;
        current.progress.results[index] = { answer, status: "failed", error: message };
        return true;
      });
      throw error;
    }
  });
}

function ensureAppeal(owner: string, lesson: LessonRecord, index: number, fresh: boolean): void {
  const exercise = lesson.content.exercises[index];
  const result = lesson.progress.results[index];
  if (exercise?.type !== "fill" || result?.appeal !== "pending") return;
  const answer = String(result.answer);
  const key = appealKey(lesson.id, index);
  if (fresh) jobs.forget(key);
  jobs.ensure(key, async () => {
    try {
      const decision = parseAppeal(await generateStructured({
        system: TEACHER_SYSTEM,
        prompt: appealPrompt(exercise, answer),
        schema: APPEAL_SCHEMA,
        timeoutMs: APPEAL_TIMEOUT_MS,
      }));
      await updateResult(owner, lesson.id, index, async (current, pending) => {
        if (pending.appeal !== "pending") return false;
        pending.appeal = decision.accepted ? "accepted" : "rejected";
        pending.appealNote = decision.explanation;
        if (decision.accepted) {
          pending.verdict = "correct";
          pending.score = 1;
          if (pending.attemptId) await updateAttemptScore(owner, pending.attemptId, 1);
          await reviewWords(owner, exercise.lemmas, "correct", new Date());
        }
        if (current.status === "completed") current.score = lessonScore(current);
        return true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateResult(owner, lesson.id, index, async (_current, pending) => {
        if (pending.appeal !== "pending") return false;
        pending.appeal = "failed";
        pending.appealNote = message;
        return true;
      });
      throw error;
    }
  });
}

async function resumePendingWork(ctx: Context, course: CourseRecord, lesson: LessonRecord): Promise<void> {
  let changed = false;
  for (const [key, result] of Object.entries(lesson.progress.results)) {
    const index = Number(key);
    const assessment = assessmentKey(lesson.id, index);
    if (result.status === "grading" && !jobs.isRunning(assessment)) {
      const failure = jobs.failure(assessment);
      if (failure) {
        lesson.progress.results[key] = { answer: result.answer, status: "failed", error: failure };
        changed = true;
      } else if (ctx.allowJobs) {
        ensureAssessment(ctx.owner, lesson, index, levelOf(course, lesson.unit), false);
      }
    }
    const appeal = appealKey(lesson.id, index);
    if (result.appeal === "pending" && !jobs.isRunning(appeal)) {
      const failure = jobs.failure(appeal);
      if (failure) {
        result.appeal = "failed";
        result.appealNote = failure;
        changed = true;
      } else if (ctx.allowJobs) {
        ensureAppeal(ctx.owner, lesson, index, false);
      }
    }
  }
  if (changed) await saveLesson(ctx.owner, lesson, ctx.now);
}

async function currentLesson(ctx: Context, course: CourseRecord): Promise<LessonRecord | null> {
  if (course.lessonId) {
    const lesson = await loadLesson(ctx.owner, course.lessonId);
    if (lesson && sameSlot(lesson, course.current)) return lesson;
  }
  const open = await findOpenLesson(ctx.owner, course.current);
  if (!open) {
    if (course.lessonId) {
      course.lessonId = null;
      await saveCourse(ctx.owner, course, ctx.now);
    }
    if (ctx.allowJobs) ensureLessonJob(ctx.owner, course.current, false);
    return null;
  }
  if (open.status === "ready") {
    open.status = "active";
    await saveLesson(ctx.owner, open, ctx.now);
  }
  course.lessonId = open.id;
  await saveCourse(ctx.owner, course, ctx.now);
  return open;
}

async function nextView(ctx: Context, course: CourseRecord): Promise<NextView | null> {
  const slot = nextSlot(course.current, course.plan!.units.length);
  if (!slot) return null;
  const ready = (await findOpenLesson(ctx.owner, slot)) !== null;
  if (!ready && ctx.allowJobs) ensureLessonJob(ctx.owner, slot, false);
  return { slot, ready, error: ready ? null : jobs.failure(lessonKey(ctx.owner, slot)) };
}

async function summaryOf(ctx: Context, course: CourseRecord): Promise<CourseSummary> {
  const unit = course.plan!.units[course.current.unit - 1];
  return {
    current: course.current,
    furthest: course.furthest,
    totalUnits: course.plan!.units.length,
    lessonsPerUnit: LESSONS_PER_UNIT,
    unit: { level: unit.level, titleEs: unit.titleEs, titlePt: unit.titlePt, theme: unit.theme },
    lessonsCompleted: course.lessonsCompleted,
    streakDays: currentStreak(course.lastStudyDay, course.streakDays, studyDay(ctx.now, ctx.timeZone)),
    vocabulary: await vocabularyCounts(ctx.owner, ctx.now),
  };
}

async function stateOf(ctx: Context): Promise<CourseState> {
  const course = await loadCourse(ctx.owner);
  if (!course) return { status: "welcome", error: null, course: null, lesson: null, next: null };
  if (!course.plan) {
    if (ctx.allowJobs) ensurePlanJob(ctx.owner);
    return { status: "preparing-course", error: jobs.failure(planKey(ctx.owner)), course: null, lesson: null, next: null };
  }
  const lesson = await currentLesson(ctx, course);
  const summary = await summaryOf(ctx, course);
  if (!lesson) {
    return { status: "preparing-lesson", error: jobs.failure(lessonKey(ctx.owner, course.current)), course: summary, lesson: null, next: null };
  }
  await resumePendingWork(ctx, course, lesson);
  const next = lesson.status === "completed" ? await nextView(ctx, course) : null;
  return { status: "lesson", error: null, course: summary, lesson: lessonView(lesson), next };
}

async function requireLesson(ctx: Context, lessonId: unknown): Promise<{ course: CourseRecord; lesson: LessonRecord }> {
  const course = await loadCourse(ctx.owner);
  if (!course?.plan) throw new CourseRejection("no-course");
  const lesson = await currentLesson(ctx, course);
  if (!lesson || lesson.id !== lessonId || lesson.status === "completed") throw new CourseRejection("out-of-sync");
  return { course, lesson };
}

function currentExercise(lesson: LessonRecord, index: unknown): Exercise {
  const step = stepsOf(lesson.content)[lesson.progress.cursor];
  if (step?.kind !== "exercise" || step.index !== index) throw new CourseRejection("out-of-sync");
  return lesson.content.exercises[step.index];
}

async function completeLesson(ctx: Context, course: CourseRecord, lesson: LessonRecord): Promise<void> {
  lesson.status = "completed";
  lesson.score = lessonScore(lesson);
  const today = studyDay(ctx.now, ctx.timeZone);
  course.streakDays = nextStreak(course.lastStudyDay, course.streakDays, today);
  course.lastStudyDay = today;
  course.lessonsCompleted += 1;
  const next = nextSlot(course.current, course.plan!.units.length);
  if (next && slotIndex(next) > slotIndex(course.furthest)) course.furthest = next;
  await saveCourse(ctx.owner, course, ctx.now);
  if (next) ensureLessonJob(ctx.owner, next, true);
}

export function readState(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, () => stateOf(ctx));
}

export function startCourse(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    await createCourse(ctx.owner, ctx.now);
    return stateOf(ctx);
  });
}

export function continueLesson(ctx: Context, lessonId: unknown, cursor: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const { course, lesson } = await requireLesson(ctx, lessonId);
    if (cursor !== lesson.progress.cursor) throw new CourseRejection("out-of-sync");
    const steps = stepsOf(lesson.content);
    const step = steps[lesson.progress.cursor];
    if (step.kind === "exercise") {
      const result = lesson.progress.results[step.index];
      if (result?.status !== "graded" || result.appeal === "pending") throw new CourseRejection("not-ready");
    }
    if (step.kind === "vocabulary") await addWords(ctx.owner, lesson.unit, lesson.content.vocabulary, ctx.now);
    lesson.progress.cursor += 1;
    if (lesson.progress.cursor >= steps.length) {
      await completeLesson(ctx, course, lesson);
    } else if (lesson.progress.cursor >= Math.ceil(steps.length / 2)) {
      const next = nextSlot(course.current, course.plan!.units.length);
      if (next) ensureLessonJob(ctx.owner, next, true);
    }
    await saveLesson(ctx.owner, lesson, ctx.now);
    return stateOf(ctx);
  });
}

function textAnswer(answer: unknown): string {
  if (typeof answer !== "string") throw new CourseRejection("invalid-answer");
  const trimmed = answer.trim();
  if (!trimmed || trimmed.length > MAX_ANSWER_CHARS) throw new CourseRejection("invalid-answer");
  return trimmed;
}

const ACCENT_FEEDBACK = "Quase: a palavra está certa, mas a acentuação não. No DELE, acento errado conta como erro.";

export function answerExercise(ctx: Context, lessonId: unknown, index: unknown, answer: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const { course, lesson } = await requireLesson(ctx, lessonId);
    const exercise = currentExercise(lesson, index);
    const position = index as number;
    const previous = lesson.progress.results[position];
    if (previous && previous.status !== "failed") throw new CourseRejection("out-of-sync");

    if (exercise.type === "translate" || exercise.type === "write") {
      lesson.progress.results[position] = { answer: textAnswer(answer), status: "grading" };
      await saveLesson(ctx.owner, lesson, ctx.now);
      ensureAssessment(ctx.owner, lesson, position, levelOf(course, lesson.unit), true);
      return stateOf(ctx);
    }

    let given: string;
    let grade: LocalGrade;
    if (exercise.type === "choice") {
      if (!Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= exercise.options.length) throw new CourseRejection("invalid-answer");
      given = exercise.options[answer as number];
      grade = gradeChoice(exercise.answer, answer as number);
    } else {
      given = textAnswer(answer);
      grade = gradeFill(exercise.answers, given);
    }
    const attemptId = await recordAttempt(ctx.owner, {
      lessonId: lesson.id, index: position, skill: exercise.skill, focus: exercise.focus,
      prompt: exerciseSummary(exercise), answer: given, expected: expectedAnswer(exercise), score: grade.score,
    }, ctx.now);
    await reviewWords(ctx.owner, exercise.lemmas, grade.verdict, ctx.now);
    lesson.progress.results[position] = {
      answer: exercise.type === "choice" ? answer as number : given,
      status: "graded",
      attemptId,
      verdict: grade.verdict,
      score: grade.score,
      ...(exercise.type === "fill" && grade.verdict === "partial" ? { feedback: ACCENT_FEEDBACK } : {}),
    };
    await saveLesson(ctx.owner, lesson, ctx.now);
    return stateOf(ctx);
  });
}

export function appealExercise(ctx: Context, lessonId: unknown, index: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const { lesson } = await requireLesson(ctx, lessonId);
    const exercise = currentExercise(lesson, index);
    const result = lesson.progress.results[index as number];
    if (!result || !canAppeal(exercise, result)) throw new CourseRejection("out-of-sync");
    result.appeal = "pending";
    delete result.appealNote;
    await saveLesson(ctx.owner, lesson, ctx.now);
    ensureAppeal(ctx.owner, lesson, index as number, true);
    return stateOf(ctx);
  });
}

export function advanceToNext(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await loadCourse(ctx.owner);
    if (!course?.plan) throw new CourseRejection("no-course");
    const lesson = course.lessonId ? await loadLesson(ctx.owner, course.lessonId) : null;
    if (lesson?.status !== "completed") throw new CourseRejection("out-of-sync");
    const next = nextSlot(course.current, course.plan.units.length);
    if (!next) throw new CourseRejection("course-finished");
    course.current = next;
    course.lessonId = null;
    await saveCourse(ctx.owner, course, ctx.now);
    return stateOf(ctx);
  });
}

function isSlot(value: unknown, totalUnits: number): value is Slot {
  const { unit, step } = (value ?? {}) as Partial<Slot>;
  return Number.isInteger(unit) && Number.isInteger(step) && unit! >= 1 && unit! <= totalUnits && step! >= 1 && step! <= LESSONS_PER_UNIT;
}

export function goToLesson(ctx: Context, slot: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await loadCourse(ctx.owner);
    if (!course?.plan) throw new CourseRejection("no-course");
    if (!isSlot(slot, course.plan.units.length) || slotIndex(slot) > slotIndex(course.furthest)) throw new CourseRejection("locked-lesson");
    if (!sameSlot(slot, course.current)) {
      course.current = { unit: slot.unit, step: slot.step };
      course.lessonId = null;
      await saveCourse(ctx.owner, course, ctx.now);
    }
    return stateOf(ctx);
  });
}

export function retryPreparation(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await loadCourse(ctx.owner);
    if (!course) throw new CourseRejection("no-course");
    jobs.forget(planKey(ctx.owner));
    if (course.plan) {
      jobs.forget(lessonKey(ctx.owner, course.current));
      const next = nextSlot(course.current, course.plan.units.length);
      if (next) jobs.forget(lessonKey(ctx.owner, next));
    }
    return stateOf(ctx);
  });
}

export async function courseOverview(ctx: Context): Promise<CourseOverview> {
  const course = await loadCourse(ctx.owner);
  if (!course?.plan) throw new CourseRejection("no-course");
  const [slots, skills, weak, vocabulary] = await Promise.all([
    completedSlots(ctx.owner),
    skillAccuracy(ctx.owner),
    weakFocuses(ctx.owner, new Date(ctx.now.getTime() - WEAK_FOCUS_DAYS * DAY_MS), WEAK_FOCUS_LIMIT),
    vocabularyCounts(ctx.owner, ctx.now),
  ]);
  const units = course.plan.units.map((unit, i): UnitOverview => {
    const number = i + 1;
    return {
      ...unit,
      number,
      unlocked: number <= course.furthest.unit,
      lessons: Array.from({ length: LESSONS_PER_UNIT }, (_, s) => slots.find((slot) => slot.unit === number && slot.step === s + 1) ?? null),
    };
  });
  return { current: course.current, furthest: course.furthest, roles: LESSON_ROLES.map((role) => role.name), units, skills, weakFocuses: weak, vocabulary };
}

export async function vocabularyOverview(ctx: Context): Promise<VocabularyOverview> {
  const [counts, words] = await Promise.all([vocabularyCounts(ctx.owner, ctx.now), listVocabulary(ctx.owner)]);
  return { counts, words };
}
