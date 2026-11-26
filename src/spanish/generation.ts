import { DAY_MS, learnerSnapshot } from "./learner.js";
import { generateStructured } from "./llm.js";
import { lessonPrompt, planPrompt, reinforcementPrompt, teacherSystem } from "./prompts.js";
import { jobs, withAttempts } from "./runtime.js";
import { LESSON_SCHEMA, parseLesson, parsePlan, PLAN_SCHEMA } from "./schemas.js";
import { findOpenLesson, findOpenReinforcement, insertLesson, loadCourse, savePlan } from "./store.js";
import type { CourseRecord, LearnerSnapshot, LessonContent, Slot } from "./types.js";

const PLAN_TIMEOUT_MS = 10 * 60_000;
const LESSON_TIMEOUT_MS = 8 * 60_000;
const MAX_LESSON_JOBS = 3;
const REINFORCEMENT_MAX_AGE_DAYS = 3;

export const planKey = (owner: string) => `plan:${owner}`;
const lessonPrefix = (owner: string) => `lesson:${owner}:`;
export const lessonKey = (owner: string, slot: Slot) => `${lessonPrefix(owner)}${slot.unit}:${slot.step}`;
export const reinforcementKey = (owner: string) => `reinforce:${owner}`;

export function reinforcementSince(now: Date): Date {
  return new Date(now.getTime() - REINFORCEMENT_MAX_AGE_DAYS * DAY_MS);
}

async function generateLesson(owner: string, course: CourseRecord, prompt: (learner: LearnerSnapshot) => string): Promise<LessonContent> {
  const learner = await learnerSnapshot(owner, course, new Date());
  const known = new Set(learner.knownLemmas);
  const content = await withAttempts(async () => parseLesson(await generateStructured({
    system: teacherSystem(course.student.variant),
    prompt: prompt(learner),
    schema: LESSON_SCHEMA,
    timeoutMs: LESSON_TIMEOUT_MS,
  })));
  return { ...content, vocabulary: content.vocabulary.filter((word) => !known.has(word.lemma)) };
}

async function plannedCourse(owner: string): Promise<CourseRecord & { plan: NonNullable<CourseRecord["plan"]> }> {
  const course = await loadCourse(owner);
  if (!course?.plan) throw new Error("O plano do curso ainda não existe.");
  return { ...course, plan: course.plan };
}

export function ensureLessonJob(owner: string, slot: Slot, prefetch: boolean): void {
  const key = lessonKey(owner, slot);
  if (jobs.isRunning(key)) return;
  if (jobs.runningWith(lessonPrefix(owner)) >= (prefetch ? 1 : MAX_LESSON_JOBS)) return;
  jobs.ensure(key, async () => {
    if (await findOpenLesson(owner, slot)) return;
    const course = await plannedCourse(owner);
    const content = await generateLesson(owner, course, (learner) => lessonPrompt(course.plan, slot.unit, slot.step, learner));
    await insertLesson(owner, slot, content, "regular", new Date());
  });
}

export function ensureReinforcementJob(owner: string): void {
  jobs.ensure(reinforcementKey(owner), async () => {
    if (await findOpenReinforcement(owner, reinforcementSince(new Date()))) return;
    const course = await plannedCourse(owner);
    const content = await generateLesson(owner, course, (learner) => reinforcementPrompt(course.plan, course.current.unit, learner));
    await insertLesson(owner, course.current, content, "reinforcement", new Date());
  });
}

export function ensurePlanJob(owner: string): void {
  jobs.ensure(planKey(owner), async () => {
    const course = await loadCourse(owner);
    if (!course) throw new Error("O curso ainda não foi criado.");
    const plan = await withAttempts(async () => parsePlan(await generateStructured({
      system: teacherSystem(course.student.variant),
      prompt: planPrompt(),
      schema: PLAN_SCHEMA,
      timeoutMs: PLAN_TIMEOUT_MS,
    })));
    await savePlan(owner, plan, new Date());
    ensureLessonJob(owner, { unit: 1, step: 1 }, false);
  });
}
