import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { execute, query, toMySQLDatetime } from "../database.js";
import type { DueWord, Mistake, WeakFocus } from "./prompts.js";
import { parseLesson, parsePlan } from "./schemas.js";
import { MASTERED_BOX, review } from "./srs.js";
import { SKILLS, type Contrast, type CourseRecord, type LessonContent, type LessonProgress, type LessonRecord, type LessonStatus, type Skill, type Slot, type Verdict, type VocabularyEntry } from "./types.js";

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
}

interface LessonRow extends RowDataPacket {
  id: string;
  unit: number;
  step: number;
  content: unknown;
  progress: unknown;
  status: LessonStatus;
  score: number | null;
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

export interface VocabularyCounts {
  total: number;
  mastered: number;
  due: number;
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

function parseProgress(value: unknown): LessonProgress {
  const raw = parseJson(value) as Partial<LessonProgress> | null;
  return {
    cursor: Number.isInteger(raw?.cursor) ? raw!.cursor! : 0,
    results: raw?.results && typeof raw.results === "object" ? raw.results : {},
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
    "SELECT plan, unit, step, max_unit, max_step, lesson_id, lessons_completed, streak_days, last_study_day FROM spanish_courses WHERE owner_id = ?",
    [owner],
  );
  if (!row) return null;
  return {
    plan: storedPlan(row.plan),
    current: { unit: row.unit, step: row.step },
    furthest: { unit: row.max_unit, step: row.max_step },
    lessonId: row.lesson_id,
    lessonsCompleted: row.lessons_completed,
    streakDays: row.streak_days,
    lastStudyDay: row.last_study_day,
  };
}

export async function createCourse(owner: string, now: Date): Promise<void> {
  await execute(
    `INSERT IGNORE INTO spanish_courses (owner_id, plan, unit, step, max_unit, max_step, lesson_id, lessons_completed, streak_days, last_study_day, created_at, updated_at)
     VALUES (?, NULL, 1, 1, 1, 1, NULL, 0, 0, NULL, ?, ?)`,
    [owner, datetime(now), datetime(now)],
  );
}

export async function savePlan(owner: string, plan: NonNullable<CourseRecord["plan"]>, now: Date): Promise<void> {
  await execute("UPDATE spanish_courses SET plan = ?, updated_at = ? WHERE owner_id = ?", [JSON.stringify(plan), datetime(now), owner]);
}

export async function saveCourse(owner: string, course: CourseRecord, now: Date): Promise<void> {
  await execute(
    `UPDATE spanish_courses SET unit = ?, step = ?, max_unit = ?, max_step = ?, lesson_id = ?, lessons_completed = ?, streak_days = ?,
       last_study_day = ?, updated_at = ? WHERE owner_id = ?`,
    [
      course.current.unit,
      course.current.step,
      course.furthest.unit,
      course.furthest.step,
      course.lessonId,
      course.lessonsCompleted,
      course.streakDays,
      course.lastStudyDay,
      datetime(now),
      owner,
    ],
  );
}

function toLesson(row: LessonRow): LessonRecord | null {
  try {
    return {
      id: row.id,
      unit: row.unit,
      step: row.step,
      content: parseLesson(parseJson(row.content)),
      progress: parseProgress(row.progress),
      status: row.status,
      score: row.score,
    };
  } catch {
    return null;
  }
}

export async function insertLesson(owner: string, slot: Slot, content: LessonContent, now: Date): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO spanish_lessons (id, owner_id, unit, step, content, progress, status, score, created_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ready', NULL, ?, NULL, NULL)`,
    [id, owner, slot.unit, slot.step, JSON.stringify(content), JSON.stringify({ cursor: 0, results: {} } satisfies LessonProgress), datetime(now)],
  );
  return id;
}

const LESSON_COLUMNS = "id, unit, step, content, progress, status, score";

export async function loadLesson(owner: string, id: string): Promise<LessonRecord | null> {
  const [row] = await query<LessonRow[]>(`SELECT ${LESSON_COLUMNS} FROM spanish_lessons WHERE owner_id = ? AND id = ?`, [owner, id]);
  return row ? toLesson(row) : null;
}

export async function findOpenLesson(owner: string, slot: Slot): Promise<LessonRecord | null> {
  const rows = await query<LessonRow[]>(
    `SELECT ${LESSON_COLUMNS} FROM spanish_lessons WHERE owner_id = ? AND unit = ? AND step = ? AND status IN ('active', 'ready')
     ORDER BY status = 'active' DESC, created_at DESC`,
    [owner, slot.unit, slot.step],
  );
  for (const row of rows) {
    const lesson = toLesson(row);
    if (lesson) return lesson;
  }
  return null;
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

export async function completedSlots(owner: string): Promise<SlotSummary[]> {
  const rows = await query<(RowDataPacket & { unit: number; step: number; best: number; times: number })[]>(
    `SELECT unit, step, MAX(score) AS best, COUNT(*) AS times FROM spanish_lessons
     WHERE owner_id = ? AND status = 'completed' GROUP BY unit, step ORDER BY unit, step`,
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

export async function skillAccuracy(owner: string): Promise<SkillAccuracy[]> {
  const rows = await query<(RowDataPacket & { skill: string; attempts: number; accuracy: number })[]>(
    "SELECT skill, COUNT(*) AS attempts, AVG(score) AS accuracy FROM spanish_attempts WHERE owner_id = ? GROUP BY skill",
    [owner],
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

export async function recentMistakes(owner: string, limit: number): Promise<Mistake[]> {
  const rows = await query<(RowDataPacket & { skill: string; focus: string; prompt: string; answer: string; expected: string })[]>(
    `SELECT skill, focus, prompt, answer, expected FROM spanish_attempts WHERE owner_id = ? AND score < 1
     ORDER BY id DESC LIMIT ${Math.trunc(limit)}`,
    [owner],
  );
  return rows
    .filter((row) => isSkill(row.skill))
    .map((row) => ({ skill: row.skill as Skill, focus: row.focus, prompt: row.prompt.slice(0, 240), answer: row.answer.slice(0, 240), expected: row.expected.slice(0, 240) }));
}
