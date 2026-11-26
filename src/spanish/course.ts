import { appealKey, assessmentKey, canAppeal, ensureAppeal, ensureAssessment, recordGrade, type CorrectionContext } from "./corrections.js";
import { scoreOf, stepsOf } from "./exercises.js";
import {
  ensureLessonJob,
  ensurePlanJob,
  ensureReinforcementJob,
  lessonKey,
  planKey,
  reinforcementKey,
  reinforcementSince,
} from "./generation.js";
import { gradeChoice, gradeFill, type LocalGrade } from "./grading.js";
import { weaknessTitles } from "./learner.js";
import { parseStudent } from "./profile.js";
import { LESSON_ROLES } from "./prompts.js";
import { CourseRejection, jobs, withCourseLock } from "./runtime.js";
import { currentStreak, nextStreak, studyDay } from "./srs.js";
import {
  addWords,
  completedSlots,
  createCourse,
  findOpenLesson,
  findOpenReinforcement,
  listVocabulary,
  loadCourse,
  loadLesson,
  saveCourse,
  saveLesson,
  saveStudent,
  skillAccuracy,
  vocabularyCounts,
  type SkillAccuracy,
  type SlotSummary,
  type StoredWord,
} from "./store.js";
import { ensureDiagnosis, ensureQuestion, forgetDiagnosis, questionKey, reviewView } from "./teacher.js";
import {
  LESSONS_PER_UNIT,
  type CourseRecord,
  type CourseUnit,
  type Exercise,
  type LessonRecord,
  type Slot,
  type VocabularyCounts,
} from "./types.js";
import { lessonView, type LessonView } from "./views.js";

const MAX_ANSWER_CHARS = 4000;
const MAX_QUESTION_CHARS = 1000;
const MAX_QUESTIONS_PER_STEP = 6;
const ACCENT_FEEDBACK = "Quase: a palavra está certa, mas a acentuação não. No DELE, acento errado conta como erro.";

export interface CourseSummary {
  current: Slot;
  furthest: Slot;
  totalUnits: number;
  lessonsPerUnit: number;
  unit: Pick<CourseUnit, "level" | "titleEs" | "titlePt" | "theme">;
  lessonsCompleted: number;
  streakDays: number;
  vocabulary: VocabularyCounts;
  reinforcing: boolean;
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

function totalUnits(course: CourseRecord): number {
  return course.plan!.units.length;
}

function correctionContext(owner: string, course: CourseRecord, lesson: LessonRecord): CorrectionContext {
  return {
    owner,
    level: course.plan?.units[lesson.unit - 1]?.level ?? "B1",
    variant: course.student.variant,
    weaknesses: weaknessTitles(course),
  };
}

function belongsToCourse(lesson: LessonRecord, course: CourseRecord): boolean {
  return course.reinforcing ? lesson.kind === "reinforcement" : lesson.kind === "regular" && sameSlot(lesson, course.current);
}

async function currentLesson(ctx: Context, course: CourseRecord): Promise<LessonRecord | null> {
  if (course.lessonId) {
    const lesson = await loadLesson(ctx.owner, course.lessonId);
    if (lesson && belongsToCourse(lesson, course)) return lesson;
  }
  const open = course.reinforcing
    ? await findOpenReinforcement(ctx.owner, reinforcementSince(ctx.now))
    : await findOpenLesson(ctx.owner, course.current);
  if (!open) {
    if (course.lessonId) {
      course.lessonId = null;
      await saveCourse(ctx.owner, course, ctx.now);
    }
    if (ctx.allowJobs) {
      if (course.reinforcing) ensureReinforcementJob(ctx.owner);
      else ensureLessonJob(ctx.owner, course.current, false);
    }
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

async function resumePendingWork(ctx: Context, course: CourseRecord, lesson: LessonRecord): Promise<void> {
  let changed = false;
  const corrections = correctionContext(ctx.owner, course, lesson);
  for (const [key, result] of Object.entries(lesson.progress.results)) {
    const index = Number(key);
    const assessment = assessmentKey(lesson.id, index);
    if (result.status === "grading" && !jobs.isRunning(assessment)) {
      const failure = jobs.failure(assessment);
      if (failure) {
        lesson.progress.results[key] = { answer: result.answer, status: "failed", error: failure };
        changed = true;
      } else if (ctx.allowJobs) {
        ensureAssessment(corrections, lesson, index, false);
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
        ensureAppeal(corrections, lesson, index, false);
      }
    }
  }
  for (const [stepKey, thread] of Object.entries(lesson.progress.questions)) {
    const step = Number(stepKey);
    thread.forEach((question, position) => {
      const key = questionKey(lesson.id, step, position);
      if (question.status !== "pending" || jobs.isRunning(key)) return;
      const failure = jobs.failure(key);
      if (failure) {
        question.status = "failed";
        question.error = failure;
        changed = true;
      } else if (ctx.allowJobs) {
        ensureQuestion(ctx.owner, lesson.id, step, position, false);
      }
    });
  }
  if (changed) await saveLesson(ctx.owner, lesson, ctx.now);
}

async function nextView(ctx: Context, course: CourseRecord, lesson: LessonRecord): Promise<NextView | null> {
  const slot = lesson.kind === "reinforcement" ? course.current : nextSlot(course.current, totalUnits(course));
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
    totalUnits: totalUnits(course),
    lessonsPerUnit: LESSONS_PER_UNIT,
    unit: { level: unit.level, titleEs: unit.titleEs, titlePt: unit.titlePt, theme: unit.theme },
    lessonsCompleted: course.lessonsCompleted,
    streakDays: currentStreak(course.lastStudyDay, course.streakDays, studyDay(ctx.now, ctx.timeZone)),
    vocabulary: await vocabularyCounts(ctx.owner, ctx.now),
    reinforcing: course.reinforcing,
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
    const key = course.reinforcing ? reinforcementKey(ctx.owner) : lessonKey(ctx.owner, course.current);
    return { status: "preparing-lesson", error: jobs.failure(key), course: summary, lesson: null, next: null };
  }
  await resumePendingWork(ctx, course, lesson);
  const next = lesson.status === "completed" ? await nextView(ctx, course, lesson) : null;
  return { status: "lesson", error: null, course: summary, lesson: lessonView(lesson, reviewView(ctx.owner, lesson, ctx.allowJobs)), next };
}

async function requirePlannedCourse(ctx: Context): Promise<CourseRecord> {
  const course = await loadCourse(ctx.owner);
  if (!course?.plan) throw new CourseRejection("no-course");
  return course;
}

async function requireLesson(ctx: Context, lessonId: unknown): Promise<{ course: CourseRecord; lesson: LessonRecord }> {
  const course = await requirePlannedCourse(ctx);
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
  lesson.score = scoreOf(lesson);
  const today = studyDay(ctx.now, ctx.timeZone);
  course.streakDays = nextStreak(course.lastStudyDay, course.streakDays, today);
  course.lastStudyDay = today;
  course.lessonsCompleted += 1;
  if (lesson.kind === "regular") {
    const next = nextSlot(course.current, totalUnits(course));
    if (next && slotIndex(next) > slotIndex(course.furthest)) course.furthest = next;
    if (next) ensureLessonJob(ctx.owner, next, true);
  } else {
    ensureLessonJob(ctx.owner, course.current, true);
  }
  await saveCourse(ctx.owner, course, ctx.now);
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
    const completed = lesson.progress.cursor >= steps.length;
    if (completed) {
      await completeLesson(ctx, course, lesson);
    } else if (lesson.kind === "regular" && lesson.progress.cursor >= Math.ceil(steps.length / 2)) {
      const next = nextSlot(course.current, totalUnits(course));
      if (next) ensureLessonJob(ctx.owner, next, true);
    }
    await saveLesson(ctx.owner, lesson, ctx.now);
    if (completed) ensureDiagnosis(ctx.owner, lesson.id);
    return stateOf(ctx);
  });
}

function boundedText(value: unknown, max: number, rejection: "invalid-answer" | "invalid-question"): string {
  if (typeof value !== "string") throw new CourseRejection(rejection);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new CourseRejection(rejection);
  return trimmed;
}

export function answerExercise(ctx: Context, lessonId: unknown, index: unknown, answer: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const { course, lesson } = await requireLesson(ctx, lessonId);
    const exercise = currentExercise(lesson, index);
    const position = index as number;
    const previous = lesson.progress.results[position];
    if (previous && previous.status !== "failed") throw new CourseRejection("out-of-sync");

    if (exercise.type === "translate" || exercise.type === "write") {
      lesson.progress.results[position] = { answer: boundedText(answer, MAX_ANSWER_CHARS, "invalid-answer"), status: "grading" };
      await saveLesson(ctx.owner, lesson, ctx.now);
      ensureAssessment(correctionContext(ctx.owner, course, lesson), lesson, position, true);
      return stateOf(ctx);
    }

    let given: string | number;
    let grade: LocalGrade;
    if (exercise.type === "choice") {
      if (!Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= exercise.options.length) throw new CourseRejection("invalid-answer");
      given = answer as number;
      grade = gradeChoice(exercise.answer, given);
    } else {
      given = boundedText(answer, MAX_ANSWER_CHARS, "invalid-answer");
      grade = gradeFill(exercise.answers, given);
    }
    const result = {
      answer: given,
      status: "graded" as const,
      verdict: grade.verdict,
      score: grade.score,
      ...(exercise.type === "fill" && grade.verdict === "partial" ? { feedback: ACCENT_FEEDBACK } : {}),
    };
    lesson.progress.results[position] = { ...result, attemptId: await recordGrade(ctx.owner, lesson.id, position, exercise, result, ctx.now) };
    await saveLesson(ctx.owner, lesson, ctx.now);
    return stateOf(ctx);
  });
}

export function appealExercise(ctx: Context, lessonId: unknown, index: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const { course, lesson } = await requireLesson(ctx, lessonId);
    const exercise = currentExercise(lesson, index);
    const result = lesson.progress.results[index as number];
    if (!result || !canAppeal(exercise, result)) throw new CourseRejection("out-of-sync");
    result.appeal = "pending";
    delete result.appealNote;
    await saveLesson(ctx.owner, lesson, ctx.now);
    ensureAppeal(correctionContext(ctx.owner, course, lesson), lesson, index as number, true);
    return stateOf(ctx);
  });
}

export function askTeacher(ctx: Context, lessonId: unknown, step: unknown, question: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const { lesson } = await requireLesson(ctx, lessonId);
    const total = stepsOf(lesson.content).length;
    if (!Number.isInteger(step) || (step as number) < 0 || (step as number) > lesson.progress.cursor || (step as number) >= total) {
      throw new CourseRejection("out-of-sync");
    }
    const position = step as number;
    const text = boundedText(question, MAX_QUESTION_CHARS, "invalid-question");
    const thread = lesson.progress.questions[position] ?? [];
    if (thread.some((item) => item.status === "pending")) throw new CourseRejection("question-pending");
    if (thread.length >= MAX_QUESTIONS_PER_STEP) throw new CourseRejection("question-limit");
    thread.push({ question: text, status: "pending", askedAt: ctx.now.toISOString() });
    lesson.progress.questions[position] = thread;
    await saveLesson(ctx.owner, lesson, ctx.now);
    ensureQuestion(ctx.owner, lesson.id, position, thread.length - 1, true);
    return stateOf(ctx);
  });
}

export function advanceToNext(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await requirePlannedCourse(ctx);
    const lesson = course.lessonId ? await loadLesson(ctx.owner, course.lessonId) : null;
    if (lesson?.status !== "completed") throw new CourseRejection("out-of-sync");
    if (lesson.kind === "reinforcement") {
      course.reinforcing = false;
    } else {
      const next = nextSlot(course.current, totalUnits(course));
      if (!next) throw new CourseRejection("course-finished");
      course.current = next;
    }
    course.lessonId = null;
    await saveCourse(ctx.owner, course, ctx.now);
    return stateOf(ctx);
  });
}

export function startReinforcement(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await requirePlannedCourse(ctx);
    if (!course.reinforcing) {
      const lesson = course.lessonId ? await loadLesson(ctx.owner, course.lessonId) : null;
      if (lesson?.kind === "regular" && lesson.status === "completed") {
        course.current = nextSlot(course.current, totalUnits(course)) ?? course.current;
      }
      course.reinforcing = true;
      course.lessonId = null;
      await saveCourse(ctx.owner, course, ctx.now);
    }
    return stateOf(ctx);
  });
}

function isSlot(value: unknown, units: number): value is Slot {
  const { unit, step } = (value ?? {}) as Partial<Slot>;
  return Number.isInteger(unit) && Number.isInteger(step) && unit! >= 1 && unit! <= units && step! >= 1 && step! <= LESSONS_PER_UNIT;
}

export function goToLesson(ctx: Context, slot: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await requirePlannedCourse(ctx);
    if (!isSlot(slot, totalUnits(course)) || slotIndex(slot) > slotIndex(course.furthest)) throw new CourseRejection("locked-lesson");
    if (course.reinforcing || !sameSlot(slot, course.current)) {
      course.current = { unit: slot.unit, step: slot.step };
      course.reinforcing = false;
      course.lessonId = null;
      await saveCourse(ctx.owner, course, ctx.now);
    }
    return stateOf(ctx);
  });
}

export function saveStudentInfo(ctx: Context, student: unknown): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    if (!(await loadCourse(ctx.owner))) throw new CourseRejection("no-course");
    await saveStudent(ctx.owner, parseStudent(student), ctx.now);
    return stateOf(ctx);
  });
}

export function retryPreparation(ctx: Context): Promise<CourseState> {
  return withCourseLock(ctx.owner, async () => {
    const course = await loadCourse(ctx.owner);
    if (!course) throw new CourseRejection("no-course");
    jobs.forget(planKey(ctx.owner));
    jobs.forget(reinforcementKey(ctx.owner));
    if (course.lessonId) forgetDiagnosis(course.lessonId);
    if (course.plan) {
      jobs.forget(lessonKey(ctx.owner, course.current));
      const next = nextSlot(course.current, totalUnits(course));
      if (next) jobs.forget(lessonKey(ctx.owner, next));
    }
    return stateOf(ctx);
  });
}

export async function courseOverview(ctx: Context): Promise<CourseOverview> {
  const course = await requirePlannedCourse(ctx);
  const [slots, skills, vocabulary] = await Promise.all([
    completedSlots(ctx.owner),
    skillAccuracy(ctx.owner, null),
    vocabularyCounts(ctx.owner, ctx.now),
  ]);
  const units = course.plan!.units.map((unit, i): UnitOverview => {
    const number = i + 1;
    return {
      ...unit,
      number,
      unlocked: number <= course.furthest.unit,
      lessons: Array.from({ length: LESSONS_PER_UNIT }, (_, s) => slots.find((slot) => slot.unit === number && slot.step === s + 1) ?? null),
    };
  });
  return { current: course.current, furthest: course.furthest, roles: LESSON_ROLES.map((role) => role.name), units, skills, vocabulary };
}

export async function vocabularyOverview(ctx: Context): Promise<VocabularyOverview> {
  const [counts, words] = await Promise.all([vocabularyCounts(ctx.owner, ctx.now), listVocabulary(ctx.owner)]);
  return { counts, words };
}
