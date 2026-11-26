export type Availability = "playable" | "awaiting-input" | "not-running";
export type Unavailable = Exclude<Availability, "playable">;

export type Skill = "vocabulario" | "conectores" | "conjugacion" | "ser_estar" | "falsos_amigos" | "gramatica";
export type Level = "A2+" | "B1" | "B1+" | "B2";
export type Contrast = "cognato" | "falso_amigo" | "heterogenerico" | "heterotonico" | "heterossemantico" | "nenhum";
export type Verdict = "correct" | "partial" | "incorrect";
export type Priority = "alta" | "media" | "baixa";
export type Trend = "novo" | "persistente" | "melhorando";
export type Pace = "consolidar" | "manter" | "acelerar";
export type Variant = "peninsular" | "americana";
export type ErrorCategory = "conjugacion" | "ser_estar" | "falso_amigo" | "conector" | "vocabulario" | "preposicion" | "concordancia" | "ortografia" | "acentuacion" | "gramatica";

export interface Slot {
  unit: number;
  step: number;
}

export interface Translated {
  es: string;
  pt: string;
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

export interface CorrectionNote {
  fragment: string;
  correction: string;
  category: string;
  explanation: string;
}

export interface ResultView {
  answer: string | number;
  status: "grading" | "graded" | "failed";
  verdict?: Verdict;
  score?: number;
  feedback?: string;
  corrected?: string;
  improved?: string;
  notes?: CorrectionNote[];
  appeal?: "pending" | "accepted" | "rejected" | "failed";
  appealNote?: string;
  error?: string;
  expected: string;
  explanation: string;
  correctOption: number | null;
  canAppeal: boolean;
}

export interface ExerciseView {
  index: number;
  type: "choice" | "fill" | "translate" | "write";
  skill: Skill;
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

export interface QuestionView {
  question: string;
  status: "pending" | "answered" | "failed";
  answer?: string;
  error?: string;
}

export type StepView = (
  | { kind: "explanation"; title: string; body: string; examples: Translated[] }
  | { kind: "vocabulary"; words: VocabularyEntry[] }
  | { kind: "reading"; title: string; text: string; glossary: Translated[] }
  | { kind: "exercise"; exercise: ExerciseView }
) & { questions: QuestionView[] };

export interface Recommendation {
  recommended: boolean;
  reason: string;
}

export type ReviewView =
  | { status: "ready"; comment: string; reinforcement: Recommendation; pace: Pace }
  | { status: "pending" }
  | { status: "failed"; error: string };

export interface LessonView {
  id: string;
  kind: "regular" | "reinforcement";
  unit: number;
  step: number;
  role: string;
  title: string;
  goal: string;
  cursor: number;
  completed: boolean;
  score: number | null;
  steps: StepView[];
  review: ReviewView | null;
}

export interface VocabularyCounts {
  total: number;
  mastered: number;
  due: number;
}

export interface CourseSummary {
  current: Slot;
  furthest: Slot;
  totalUnits: number;
  lessonsPerUnit: number;
  unit: { level: Level; titleEs: string; titlePt: string; theme: string };
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

export interface CourseState {
  status: "welcome" | "preparing-course" | "preparing-lesson" | "lesson";
  error: string | null;
  course: CourseSummary | null;
  lesson: LessonView | null;
  next: NextView | null;
}

export interface StateResponse {
  state: CourseState;
  availability?: Availability;
}

export interface SlotSummary {
  unit: number;
  step: number;
  best: number;
  times: number;
}

export interface UnitOverview {
  number: number;
  level: Level;
  titleEs: string;
  titlePt: string;
  theme: string;
  grammar: string[];
  connectors: string[];
  contrasts: string[];
  dele: string;
  unlocked: boolean;
  lessons: (SlotSummary | null)[];
}

export interface SkillAccuracy {
  skill: Skill;
  attempts: number;
  accuracy: number;
}

export interface CourseOverview {
  current: Slot;
  furthest: Slot;
  roles: string[];
  units: UnitOverview[];
  skills: SkillAccuracy[];
  vocabulary: VocabularyCounts;
}

export interface StoredWord extends VocabularyEntry {
  unit: number;
  box: number;
  dueAt: string;
  correct: number;
  wrong: number;
  learnedAt: string;
}

export interface VocabularyOverview {
  counts: VocabularyCounts;
  words: StoredWord[];
}

export interface Weakness {
  id: string;
  title: string;
  skill: Skill;
  rule: string;
  interference: string;
  examples: { wrong: string; right: string }[];
  priority: Priority;
  trend: Trend;
  since: string;
}

export interface LearnerProfile {
  weaknesses: Weakness[];
  strengths: string[];
  resolved: { id: string; title: string; resolvedAt: string }[];
  pace: Pace;
  guidance: string;
  updatedAt: string;
  lessonsAnalyzed: number;
}

export interface StudentInfo {
  goal: string;
  examDate: string | null;
  interests: string;
  notes: string;
  variant: Variant;
}

export interface ReviewEntry {
  lessonId: string;
  title: string;
  kind: "regular" | "reinforcement";
  unit: number;
  step: number;
  review: { comment: string; reinforcement: Recommendation; pace: Pace; createdAt: string };
  completedAt: string;
}

export interface TeacherOverview {
  profile: LearnerProfile | null;
  reviews: ReviewEntry[];
  categories: { category: ErrorCategory; count: number }[];
  student: StudentInfo;
  examDaysLeft: number | null;
}
