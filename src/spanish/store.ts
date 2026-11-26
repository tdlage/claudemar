import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { execute, query, toMySQLDatetime } from "../database.js";
import { errorsOf } from "./errors.js";
import { DEFAULT_STUDENT, parseStoredProfile, parseStoredReview, parseStudent } from "./profile.js";
import { parseLesson, parsePlan } from "./schemas.js";
import { MASTERED_BOX, review } from "./srs.js";
import {
  ERROR_CATEGORIES,
  SKILLS,
  type Contrast,
  type CourseRecord,
  type DueWord,
  type ErrorCategory,
  type ErrorRecord,
  type LearnerProfile,
  type Leech,
  type LessonContent,
  type LessonKind,
  type LessonProgress,
  type LessonRecord,
  type LessonReview,
  type LessonStatus,
  type RecentError,
  type Skill,
  type Slot,
  type StudentInfo,
  type Verdict,
  type VocabularyCounts,
  type VocabularyEntry,
  type WeakFocus,
} from "./types.js";

interface CourseRow extends RowDataPacket {
  plan: unknown;
  unit: number;
  step: number;
  max_unit: number;
  max_step: number;
  lesson_id: string | null;
  lessons_completed: number;
  streak_days: number;
  last_study_day: string | null;
  reinforcing: number;
  profile: unknown;
  student: unknown;
}

interface LessonRow extends RowDataPacket {
  id: string;
  kind: string;
  unit: number;
  step: number;
  content: unknown;
  progress: unknown;
  status: LessonStatus;
  score: number | null;
  review: unknown;
}

interface WordRow extends RowDataPacket {
  lemma: string;
  display: string;
  part_of_speech: string;
  translation: string;
  example_es: string;
  example_pt: string;
  note: string;
  contrast: Contrast;
  unit: number;
  box: number;
  due_at: Date | string;
  correct_count: number;
  wrong_count: number;
  created_at: Date | string;
}

export interface StoredWord {
  lemma: string;
  display: string;
  partOfSpeech: string;
  translation: string;
  exampleEs: string;
  examplePt: string;
  note: string;
  contrast: Contrast;
  unit: number;
  box: number;
  dueAt: string;
  correct: number;
  wrong: number;
  learnedAt: string;
}

export interface SkillAccuracy {
  skill: Skill;
  attempts: number;
  accuracy: number;
}

export interface SlotSummary {
  unit: number;
  step: number;
  best: number;
  times: number;
}

export interface AttemptInput {
  lessonId: string;
  index: number;
  skill: Skill;
  focus: string;
  prompt: string;
  answer: string;
  expected: string;
  score: number;
}

export interface ReviewEntry {
  lessonId: string;
  title: string;
  kind: LessonKind;
  unit: number;
  step: number;
  review: LessonReview;
  completedAt: string;
}

export interface ScoreEntry {
  title: string;
  kind: LessonKind;
  unit: number;
  step: number;
  score: number;
}

export interface CategoryCount {
  category: ErrorCategory;
  count: number;
}

export interface ErrorSource {
  lessonId: string;
  index: number;
  attemptId: number | null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function datetime(date: Date): string {
  return toMySQLDatetime(date.toISOString());
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value.replace(" ", "T")}Z`);
}

function isSkill(value: unknown): value is Skill {
  return SKILLS.includes(value as Skill);
}

function isCategory(value: unknown): value is ErrorCategory {
  return ERROR_CATEGORIES.includes(value as ErrorCategory);
}

function lessonKind(value: unknown): LessonKind {
  return value === "reinforcement" ? "reinforcement" : "regular";
}

function parseProgress(value: unknown): LessonProgress {
  const raw = parseJson(value) as Partial<LessonProgress> | null;
  return {
    cursor: Number.isInteger(raw?.cursor) ? raw!.cursor! : 0,
    results: raw?.results && typeof raw.results === "object" ? raw.results : {},
    questions: raw?.questions && typeof raw.questions === "object" ? raw.questions : {},
  };
}

function storedPlan(value: unknown): CourseRecord["plan"] {
  const raw = parseJson(value);
  if (!raw) return null;
  try {
    return parsePlan(raw);
  } catch {
    return null;
  }
}

export async function loadCourse(owner: string): Promise<CourseRecord | null> {
  const [row] = await query<CourseRow[]>(
    `SELECT plan, unit, step, max_unit, max_step, lesson_id, lessons_completed, streak_days, last_study_day, reinforcing, profile, student
     FROM spanish_courses WHERE owner_id = ?`,
    [owner],
  );
  if (!row) return null;
  const student = parseJson(row.student);
  return {
    plan: storedPlan(row.plan),
    current: { unit: row.unit, step: row.step },
    furthest: { unit: row.max_unit, step: row.max_step },
    lessonId: row.lesson_id,
    lessonsCompleted: row.lessons_completed,
    streakDays: row.streak_days,
    lastStudyDay: row.last_study_day,
    reinforcing: Boolean(row.reinforcing),
    profile: parseStoredProfile(parseJson(row.profile)),
    student: student ? parseStudent(student) : DEFAULT_STUDENT,
  };
}

export async function createCourse(owner: string, now: Date): Promise<void> {
  await execute(
    `INSERT IGNORE INTO spanish_courses (owner_id, plan, unit, step, max_unit, max_step, lesson_id, lessons_completed, streak_days, last_study_day,
       reinforcing, profile, student, created_at, updated_at)
     VALUES (?, NULL, 1, 1, 1, 1, NULL, 0, 0, NULL, 0, NULL, NULL, ?, ?)`,
    [owner, datetime(now), datetime(now)],
  );
}

export async function savePlan(owner: string, plan: NonNullable<CourseRecord["plan"]>, now: Date): Promise<void> {
  await execute("UPDATE spanish_courses SET plan = ?, updated_at = ? WHERE owner_id = ?", [JSON.stringify(plan), datetime(now), owner]);
}

export async function saveProfile(owner: string, profile: LearnerProfile, now: Date): Promise<void> {
  await execute("UPDATE spanish_courses SET profile = ?, updated_at = ? WHERE owner_id = ?", [JSON.stringify(profile), datetime(now), owner]);
}

export async function saveStudent(owner: string, student: StudentInfo, now: Date): Promise<void> {
  await execute("UPDATE spanish_courses SET student = ?, updated_at = ? WHERE owner_id = ?", [JSON.stringify(student), datetime(now), owner]);
}

export async function saveCourse(owner: string, course: CourseRecord, now: Date): Promise<void> {
  await execute(
    `UPDATE spanish_courses SET unit = ?, step = ?, max_unit = ?, max_step = ?, lesson_id = ?, lessons_completed = ?, streak_days = ?,
       last_study_day = ?, reinforcing = ?, updated_at = ? WHERE owner_id = ?`,
    [
      course.current.unit,
      course.current.step,
      course.furthest.unit,
      course.furthest.step,
      course.lessonId,
      course.lessonsCompleted,
      course.streakDays,
      course.lastStudyDay,
      course.reinforcing ? 1 : 0,
      datetime(now),
      owner,
    ],
  );
}

function toLesson(row: LessonRow): LessonRecord | null {
  try {
    return {
      id: row.id,
      kind: lessonKind(row.kind),
      unit: row.unit,
      step: row.step,
      content: parseLesson(parseJson(row.content)),
      progress: parseProgress(row.progress),
      status: row.status,
      score: row.score,
      review: parseStoredReview(parseJson(row.review)),
    };
  } catch {
    return null;
  }
}

export async function insertLesson(owner: string, slot: Slot, content: LessonContent, kind: LessonKind, now: Date): Promise<string> {
  const id = randomUUID();
  const progress: LessonProgress = { cursor: 0, results: {}, questions: {} };
  await execute(
    `INSERT INTO spanish_lessons (id, owner_id, kind, unit, step, content, progress, status, score, review, created_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', NULL, NULL, ?, NULL, NULL)`,
    [id, owner, kind, slot.unit, slot.step, JSON.stringify(content), JSON.stringify(progress), datetime(now)],
  );
  return id;
}

const LESSON_COLUMNS = "id, kind, unit, step, content, progress, status, score, review";

export async function loadLesson(owner: string, id: string): Promise<LessonRecord | null> {
  const [row] = await query<LessonRow[]>(`SELECT ${LESSON_COLUMNS} FROM spanish_lessons WHERE owner_id = ? AND id = ?`, [owner, id]);
  return row ? toLesson(row) : null;
}

function firstValid(rows: LessonRow[]): LessonRecord | null {
  for (const row of rows) {
    const lesson = toLesson(row);
    if (lesson) return lesson;
  }
  return null;
}

export async function findOpenLesson(owner: string, slot: Slot): Promise<LessonRecord | null> {
  const rows = await query<LessonRow[]>(
    `SELECT ${LESSON_COLUMNS} FROM spanish_lessons
     WHERE owner_id = ? AND kind = 'regular' AND unit = ? AND step = ? AND status IN ('active', 'ready')
     ORDER BY status = 'active' DESC, created_at DESC`,
    [owner, slot.unit, slot.step],
  );
  return firstValid(rows);
}

export async function findOpenReinforcement(owner: string, since: Date): Promise<LessonRecord | null> {
  const rows = await query<LessonRow[]>(
    `SELECT ${LESSON_COLUMNS} FROM spanish_lessons
     WHERE owner_id = ? AND kind = 'reinforcement' AND status IN ('active', 'ready') AND created_at >= ?
     ORDER BY status = 'active' DESC, created_at DESC`,
    [owner, datetime(since)],
  );
  return firstValid(rows);
}

export async function saveLesson(owner: string, lesson: LessonRecord, now: Date): Promise<void> {
  await execute(
    `UPDATE spanish_lessons SET progress = ?, status = ?, score = ?,
       started_at = COALESCE(started_at, IF(? <> 'ready', ?, NULL)),
       completed_at = IF(? = 'completed', COALESCE(completed_at, ?), NULL)
     WHERE owner_id = ? AND id = ?`,
    [JSON.stringify(lesson.progress), lesson.status, lesson.score, lesson.status, datetime(now), lesson.status, datetime(now), owner, lesson.id],
  );
}

export async function saveLessonReview(owner: string, lessonId: string, lessonReview: LessonReview): Promise<void> {
  await execute("UPDATE spanish_lessons SET review = ? WHERE owner_id = ? AND id = ?", [JSON.stringify(lessonReview), owner, lessonId]);
}

export async function recentReviews(owner: string, limit: number): Promise<ReviewEntry[]> {
  const rows = await query<(RowDataPacket & { id: string; kind: string; unit: number; step: number; title: string | null; review: unknown; completed_at: Date | string })[]>(
    `SELECT id, kind, unit, step, JSON_UNQUOTE(JSON_EXTRACT(content, '$.title')) AS title, review, completed_at FROM spanish_lessons
     WHERE owner_id = ? AND status = 'completed' AND review IS NOT NULL ORDER BY completed_at DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows.flatMap((row) => {
    const lessonReview = parseStoredReview(parseJson(row.review));
    return lessonReview ? [{
      lessonId: row.id,
      title: row.title ?? "",
      kind: lessonKind(row.kind),
      unit: row.unit,
      step: row.step,
      review: lessonReview,
      completedAt: toDate(row.completed_at).toISOString(),
    }] : [];
  });
}

export async function recentScores(owner: string, limit: number): Promise<ScoreEntry[]> {
  const rows = await query<(RowDataPacket & { kind: string; unit: number; step: number; title: string | null; score: number | null })[]>(
    `SELECT kind, unit, step, JSON_UNQUOTE(JSON_EXTRACT(content, '$.title')) AS title, score FROM spanish_lessons
     WHERE owner_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows.map((row) => ({ title: row.title ?? "", kind: lessonKind(row.kind), unit: row.unit, step: row.step, score: Number(row.score ?? 0) }));
}

export async function completedSlots(owner: string): Promise<SlotSummary[]> {
  const rows = await query<(RowDataPacket & { unit: number; step: number; best: number; times: number })[]>(
    `SELECT unit, step, MAX(score) AS best, COUNT(*) AS times FROM spanish_lessons
     WHERE owner_id = ? AND kind = 'regular' AND status = 'completed' GROUP BY unit, step ORDER BY unit, step`,
    [owner],
  );
  return rows.map((row) => ({ unit: row.unit, step: row.step, best: Number(row.best ?? 0), times: Number(row.times) }));
}

export async function recentLessonTitles(owner: string, limit: number): Promise<string[]> {
  const rows = await query<(RowDataPacket & { title: string | null })[]>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(content, '$.title')) AS title FROM spanish_lessons
     WHERE owner_id = ? AND status <> 'ready' ORDER BY created_at DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows.map((row) => row.title ?? "").filter(Boolean);
}

export async function addWords(owner: string, unit: number, words: VocabularyEntry[], now: Date): Promise<void> {
  for (const word of words) {
    await execute(
      `INSERT IGNORE INTO spanish_vocabulary (owner_id, lemma, display, part_of_speech, translation, example_es, example_pt, note, contrast,
         unit, box, due_at, correct_count, wrong_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, ?)`,
      [owner, word.lemma, word.display, word.partOfSpeech, word.translation, word.exampleEs, word.examplePt, word.note, word.contrast, unit, datetime(now), datetime(now), datetime(now)],
    );
  }
}

export async function reviewWords(owner: string, lemmas: string[], verdict: Verdict, now: Date): Promise<void> {
  for (const lemma of new Set(lemmas)) {
    const [row] = await query<WordRow[]>("SELECT box, due_at FROM spanish_vocabulary WHERE owner_id = ? AND lemma = ?", [owner, lemma]);
    if (!row) continue;
    const next = review({ box: row.box, dueAt: toDate(row.due_at) }, verdict, now);
    await execute(
      `UPDATE spanish_vocabulary SET box = ?, due_at = ?, correct_count = correct_count + ?, wrong_count = wrong_count + ?, updated_at = ?
       WHERE owner_id = ? AND lemma = ?`,
      [next.box, datetime(next.dueAt), verdict === "correct" ? 1 : 0, verdict === "incorrect" ? 1 : 0, datetime(now), owner, lemma],
    );
  }
}

export async function dueWords(owner: string, now: Date, limit: number): Promise<DueWord[]> {
  const rows = await query<WordRow[]>(
    `SELECT lemma, display, translation FROM spanish_vocabulary WHERE owner_id = ? AND due_at <= ?
     ORDER BY box ASC, due_at ASC LIMIT ${Math.trunc(limit)}`,
    [owner, datetime(now)],
  );
  return rows.map((row) => ({ lemma: row.lemma, display: row.display, translation: row.translation }));
}

export async function leechWords(owner: string, limit: number): Promise<Leech[]> {
  const rows = await query<WordRow[]>(
    `SELECT lemma, display, translation, correct_count, wrong_count FROM spanish_vocabulary
     WHERE owner_id = ? AND wrong_count >= 2 AND wrong_count >= correct_count
     ORDER BY wrong_count DESC, updated_at DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows.map((row) => ({ lemma: row.lemma, display: row.display, translation: row.translation, wrong: row.wrong_count, correct: row.correct_count }));
}

export async function knownLemmas(owner: string, limit: number): Promise<string[]> {
  const rows = await query<WordRow[]>(
    `SELECT lemma FROM spanish_vocabulary WHERE owner_id = ? ORDER BY created_at DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows.map((row) => row.lemma);
}

export async function vocabularyCounts(owner: string, now: Date): Promise<VocabularyCounts> {
  const [row] = await query<(RowDataPacket & { total: number; mastered: number | null; due: number | null })[]>(
    `SELECT COUNT(*) AS total, SUM(box >= ?) AS mastered, SUM(due_at <= ?) AS due FROM spanish_vocabulary WHERE owner_id = ?`,
    [MASTERED_BOX, datetime(now), owner],
  );
  return { total: Number(row?.total ?? 0), mastered: Number(row?.mastered ?? 0), due: Number(row?.due ?? 0) };
}

export async function listVocabulary(owner: string): Promise<StoredWord[]> {
  const rows = await query<WordRow[]>(
    `SELECT lemma, display, part_of_speech, translation, example_es, example_pt, note, contrast, unit, box, due_at, correct_count, wrong_count, created_at
     FROM spanish_vocabulary WHERE owner_id = ? ORDER BY created_at DESC, lemma ASC`,
    [owner],
  );
  return rows.map((row) => ({
    lemma: row.lemma,
    display: row.display,
    partOfSpeech: row.part_of_speech,
    translation: row.translation,
    exampleEs: row.example_es,
    examplePt: row.example_pt,
    note: row.note,
    contrast: row.contrast,
    unit: row.unit,
    box: row.box,
    dueAt: toDate(row.due_at).toISOString(),
    correct: row.correct_count,
    wrong: row.wrong_count,
    learnedAt: toDate(row.created_at).toISOString(),
  }));
}

export async function recordAttempt(owner: string, attempt: AttemptInput, now: Date): Promise<number> {
  const result = await execute(
    `INSERT INTO spanish_attempts (owner_id, lesson_id, exercise_index, skill, focus, prompt, answer, expected, score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [owner, attempt.lessonId, attempt.index, attempt.skill, attempt.focus, attempt.prompt, attempt.answer, attempt.expected, attempt.score, datetime(now)],
  );
  return result.insertId;
}

export async function updateAttemptScore(owner: string, id: number, score: number): Promise<void> {
  await execute("UPDATE spanish_attempts SET score = ? WHERE owner_id = ? AND id = ?", [score, owner, id]);
}

export async function skillAccuracy(owner: string, since: Date | null): Promise<SkillAccuracy[]> {
  const rows = await query<(RowDataPacket & { skill: string; attempts: number; accuracy: number })[]>(
    `SELECT skill, COUNT(*) AS attempts, AVG(score) AS accuracy FROM spanish_attempts WHERE owner_id = ? AND created_at >= ? GROUP BY skill`,
    [owner, datetime(since ?? new Date(0))],
  );
  return rows
    .filter((row) => isSkill(row.skill))
    .map((row) => ({ skill: row.skill as Skill, attempts: Number(row.attempts), accuracy: Number(row.accuracy) }));
}

export async function weakFocuses(owner: string, since: Date, limit: number): Promise<WeakFocus[]> {
  const rows = await query<(RowDataPacket & { skill: string; focus: string; attempts: number; accuracy: number })[]>(
    `SELECT skill, focus, COUNT(*) AS attempts, AVG(score) AS accuracy FROM spanish_attempts
     WHERE owner_id = ? AND created_at >= ? AND focus <> '' GROUP BY skill, focus
     HAVING attempts >= 3 AND accuracy < 0.7 ORDER BY accuracy ASC, attempts DESC LIMIT ${Math.trunc(limit)}`,
    [owner, datetime(since)],
  );
  return rows
    .filter((row) => isSkill(row.skill))
    .map((row) => ({ skill: row.skill as Skill, focus: row.focus, attempts: Number(row.attempts), accuracy: Number(row.accuracy) }));
}

export async function insertErrors(owner: string, source: ErrorSource, errors: ErrorRecord[], at: Date): Promise<void> {
  for (const error of errors) {
    await execute(
      `INSERT INTO spanish_errors (owner_id, lesson_id, exercise_index, attempt_id, category, focus, wrong, correct, explanation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner, source.lessonId, source.index, source.attemptId, error.category, error.focus.slice(0, 120), error.wrong, error.correct, error.explanation, datetime(at)],
    );
  }
}

export async function deleteAttemptErrors(owner: string, attemptId: number): Promise<void> {
  await execute("DELETE FROM spanish_errors WHERE owner_id = ? AND attempt_id = ?", [owner, attemptId]);
}

export async function recentErrors(owner: string, limit: number): Promise<RecentError[]> {
  const rows = await query<(RowDataPacket & { category: string; focus: string; wrong: string; correct: string })[]>(
    `SELECT category, focus, wrong, correct FROM spanish_errors WHERE owner_id = ? ORDER BY id DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows
    .filter((row) => isCategory(row.category))
    .map((row) => ({ category: row.category as ErrorCategory, focus: row.focus, wrong: row.wrong.slice(0, 240), correct: row.correct.slice(0, 240) }));
}

export async function errorCategories(owner: string, since: Date): Promise<CategoryCount[]> {
  const rows = await query<(RowDataPacket & { category: string; total: number })[]>(
    `SELECT category, COUNT(*) AS total FROM spanish_errors WHERE owner_id = ? AND created_at >= ?
     GROUP BY category ORDER BY total DESC`,
    [owner, datetime(since)],
  );
  return rows.filter((row) => isCategory(row.category)).map((row) => ({ category: row.category as ErrorCategory, count: Number(row.total) }));
}

export async function backfillErrors(): Promise<void> {
  const [existing] = await query<(RowDataPacket & { total: number })[]>("SELECT COUNT(*) AS total FROM spanish_errors");
  if (Number(existing?.total ?? 0) > 0) return;
  const rows = await query<(RowDataPacket & { owner_id: string; at: Date | string } & LessonRow)[]>(
    `SELECT owner_id, ${LESSON_COLUMNS}, COALESCE(completed_at, started_at, created_at) AS at FROM spanish_lessons WHERE status <> 'ready'`,
  );
  for (const row of rows) {
    const lesson = toLesson(row);
    if (!lesson) continue;
    for (const [key, result] of Object.entries(lesson.progress.results)) {
      const index = Number(key);
      const exercise = lesson.content.exercises[index];
      if (!exercise) continue;
      await insertErrors(row.owner_id, { lessonId: lesson.id, index, attemptId: result.attemptId ?? null }, errorsOf(exercise, result), toDate(row.at));
    }
  }
}
