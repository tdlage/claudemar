import { canAppeal } from "./corrections.js";
import { expectedAnswer, stepsOf } from "./exercises.js";
import { LESSON_ROLES, REINFORCEMENT_NAME } from "./prompts.js";
import type {
  Exercise,
  ExerciseResult,
  Explanation,
  LessonKind,
  LessonRecord,
  LessonReview,
  Question,
  Reading,
  VocabularyEntry,
} from "./types.js";

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

export type QuestionView = Omit<Question, "askedAt">;

export type StepView = (
  | ({ kind: "explanation" } & Explanation)
  | { kind: "vocabulary"; words: VocabularyEntry[] }
  | ({ kind: "reading" } & Reading)
  | { kind: "exercise"; exercise: ExerciseView }
) & { questions: QuestionView[] };

export type ReviewView =
  | ({ status: "ready" } & Omit<LessonReview, "createdAt">)
  | { status: "pending" }
  | { status: "failed"; error: string };

export interface LessonView {
  id: string;
  kind: LessonKind;
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

function questionViews(questions: Question[] | undefined): QuestionView[] {
  return (questions ?? []).map(({ askedAt: _askedAt, ...visible }) => visible);
}

export function lessonRole(lesson: Pick<LessonRecord, "kind" | "step">): string {
  return lesson.kind === "reinforcement" ? REINFORCEMENT_NAME : LESSON_ROLES[lesson.step - 1]?.name ?? "";
}

export function lessonView(lesson: LessonRecord, review: ReviewView | null): LessonView {
  const { content } = lesson;
  const steps = stepsOf(content).map((step, position): StepView => {
    const questions = questionViews(lesson.progress.questions[position]);
    switch (step.kind) {
      case "explanation": return { kind: "explanation", ...content.explanation, questions };
      case "vocabulary": return { kind: "vocabulary", words: content.vocabulary, questions };
      case "reading": return { kind: "reading", ...content.reading!, questions };
      case "exercise": return { kind: "exercise", exercise: exerciseView(content.exercises[step.index], step.index, lesson.progress.results[step.index]), questions };
    }
  });
  return {
    id: lesson.id,
    kind: lesson.kind,
    unit: lesson.unit,
    step: lesson.step,
    role: lessonRole(lesson),
    title: content.title,
    goal: content.goal,
    cursor: lesson.progress.cursor,
    completed: lesson.status === "completed",
    score: lesson.score,
    steps,
    review,
  };
}
