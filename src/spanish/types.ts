export const SKILLS = ["vocabulario", "conectores", "conjugacion", "ser_estar", "falsos_amigos", "gramatica"] as const;
export type Skill = (typeof SKILLS)[number];

export const LEVELS = ["A2+", "B1", "B1+", "B2"] as const;
export type CefrLevel = (typeof LEVELS)[number];

export const CONTRASTS = ["cognato", "falso_amigo", "heterogenerico", "heterotonico", "heterossemantico", "nenhum"] as const;
export type Contrast = (typeof CONTRASTS)[number];

export const ERROR_CATEGORIES = ["conjugacion", "ser_estar", "falso_amigo", "conector", "vocabulario", "preposicion", "concordancia", "ortografia", "acentuacion", "gramatica"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const LESSONS_PER_UNIT = 4;

export interface CourseUnit {
  level: CefrLevel;
  titleEs: string;
  titlePt: string;
  theme: string;
  grammar: string[];
  connectors: string[];
  contrasts: string[];
  dele: string;
}

export interface CoursePlan {
  units: CourseUnit[];
}

export interface Translated {
  es: string;
  pt: string;
}

export interface Explanation {
  title: string;
  body: string;
  examples: Translated[];
}

export interface VocabularyEntry {
  lemma: string;
  display: string;
  partOfSpeech: string;
  translation: string;
  exampleEs: string;
  examplePt: string;
  note: string;
  contrast: Contrast;
}

export interface Reading {
  title: string;
  text: string;
  glossary: Translated[];
}

interface ExerciseBase {
  skill: Skill;
  focus: string;
  instruction: string;
  explanation: string;
  lemmas: string[];
}

export interface ChoiceExercise extends ExerciseBase {
  type: "choice";
  prompt: string;
  options: string[];
  answer: number;
}

export interface FillExercise extends ExerciseBase {
  type: "fill";
  prompt: string;
  hint: string;
  answers: string[];
}

export interface TranslateExercise extends ExerciseBase {
  type: "translate";
  source: string;
  reference: string;
}

export interface WriteExercise extends ExerciseBase {
  type: "write";
  task: string;
  requirements: string[];
  minWords: number;
  maxWords: number;
  reference: string;
}

export type Exercise = ChoiceExercise | FillExercise | TranslateExercise | WriteExercise;
export type OpenExercise = TranslateExercise | WriteExercise;

export interface LessonContent {
  title: string;
  goal: string;
  explanation: Explanation;
  vocabulary: VocabularyEntry[];
  reading: Reading | null;
  exercises: Exercise[];
}

export type Verdict = "correct" | "partial" | "incorrect";

export interface CorrectionNote {
  fragment: string;
  correction: string;
  category: ErrorCategory;
  explanation: string;
}

export interface Assessment {
  verdict: Verdict;
  score: number;
  feedback: string;
  corrected: string;
  improved: string;
  notes: CorrectionNote[];
}

export interface AppealDecision {
  accepted: boolean;
  explanation: string;
}

export interface ExerciseResult {
  answer: string | number;
  status: "grading" | "graded" | "failed";
  attemptId?: number;
  verdict?: Verdict;
  score?: number;
  feedback?: string;
  corrected?: string;
  improved?: string;
  notes?: CorrectionNote[];
  appeal?: "pending" | "accepted" | "rejected" | "failed";
  appealNote?: string;
  error?: string;
}

export interface LessonProgress {
  cursor: number;
  results: Record<string, ExerciseResult>;
}

export type LessonStatus = "ready" | "active" | "completed";

export interface LessonRecord {
  id: string;
  unit: number;
  step: number;
  content: LessonContent;
  progress: LessonProgress;
  status: LessonStatus;
  score: number | null;
}

export interface Slot {
  unit: number;
  step: number;
}

export interface CourseRecord {
  plan: CoursePlan | null;
  current: Slot;
  furthest: Slot;
  lessonId: string | null;
  lessonsCompleted: number;
  streakDays: number;
  lastStudyDay: string | null;
}
