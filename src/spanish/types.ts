export const SKILLS = ["vocabulario", "conectores", "conjugacion", "ser_estar", "falsos_amigos", "gramatica"] as const;
export type Skill = (typeof SKILLS)[number];

export const LEVELS = ["A2+", "B1", "B1+", "B2"] as const;
export type CefrLevel = (typeof LEVELS)[number];

export const CONTRASTS = ["cognato", "falso_amigo", "heterogenerico", "heterotonico", "heterossemantico", "nenhum"] as const;
export type Contrast = (typeof CONTRASTS)[number];

export const ERROR_CATEGORIES = ["conjugacion", "ser_estar", "falso_amigo", "conector", "vocabulario", "preposicion", "concordancia", "ortografia", "acentuacion", "gramatica"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const PRIORITIES = ["alta", "media", "baixa"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TRENDS = ["novo", "persistente", "melhorando"] as const;
export type Trend = (typeof TRENDS)[number];

export const PACES = ["consolidar", "manter", "acelerar"] as const;
export type Pace = (typeof PACES)[number];

export const VARIANTS = ["peninsular", "americana"] as const;
export type Variant = (typeof VARIANTS)[number];

export type LessonKind = "regular" | "reinforcement";

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

export interface Question {
  question: string;
  status: "pending" | "answered" | "failed";
  answer?: string;
  error?: string;
  askedAt: string;
}

export interface LessonProgress {
  cursor: number;
  results: Record<string, ExerciseResult>;
  questions: Record<string, Question[]>;
}

export interface WeaknessExample {
  wrong: string;
  right: string;
}

export interface Weakness {
  id: string;
  title: string;
  skill: Skill;
  rule: string;
  interference: string;
  examples: WeaknessExample[];
  priority: Priority;
  trend: Trend;
  since: string;
}

export interface ResolvedWeakness {
  id: string;
  title: string;
  resolvedAt: string;
}

export interface LearnerProfile {
  weaknesses: Weakness[];
  strengths: string[];
  resolved: ResolvedWeakness[];
  pace: Pace;
  guidance: string;
  updatedAt: string;
  lessonsAnalyzed: number;
}

export interface Recommendation {
  recommended: boolean;
  reason: string;
}

export interface Diagnosis {
  comment: string;
  weaknesses: Omit<Weakness, "since">[];
  strengths: string[];
  resolved: string[];
  pace: Pace;
  guidance: string;
  reinforcement: Recommendation;
}

export interface LessonReview {
  comment: string;
  reinforcement: Recommendation;
  pace: Pace;
  createdAt: string;
}

export interface StudentInfo {
  goal: string;
  examDate: string | null;
  interests: string;
  notes: string;
  variant: Variant;
}

export interface ErrorRecord {
  category: ErrorCategory;
  focus: string;
  wrong: string;
  correct: string;
  explanation: string;
}

export interface VocabularyCounts {
  total: number;
  mastered: number;
  due: number;
}

export interface DueWord {
  lemma: string;
  display: string;
  translation: string;
}

export interface Leech extends DueWord {
  wrong: number;
  correct: number;
}

export interface WeakFocus {
  skill: Skill;
  focus: string;
  accuracy: number;
  attempts: number;
}

export interface RecentError {
  category: ErrorCategory;
  focus: string;
  wrong: string;
  correct: string;
}

export interface LearnerSnapshot {
  student: StudentInfo;
  profile: LearnerProfile | null;
  knownLemmas: string[];
  vocabulary: VocabularyCounts;
  dueWords: DueWord[];
  leeches: Leech[];
  weakFocuses: WeakFocus[];
  recentErrors: RecentError[];
  recentTitles: string[];
  examDaysLeft: number | null;
}

export type LessonStatus = "ready" | "active" | "completed";

export interface LessonRecord {
  id: string;
  kind: LessonKind;
  unit: number;
  step: number;
  content: LessonContent;
  progress: LessonProgress;
  status: LessonStatus;
  score: number | null;
  review: LessonReview | null;
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
  reinforcing: boolean;
  profile: LearnerProfile | null;
  student: StudentInfo;
}
