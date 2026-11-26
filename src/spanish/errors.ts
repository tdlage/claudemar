import { expectedAnswer, givenAnswer } from "./exercises.js";
import type { ErrorCategory, ErrorRecord, Exercise, ExerciseResult, Skill } from "./types.js";

const SKILL_CATEGORY: Record<Skill, ErrorCategory> = {
  vocabulario: "vocabulario",
  conectores: "conector",
  conjugacion: "conjugacion",
  ser_estar: "ser_estar",
  falsos_amigos: "falso_amigo",
  gramatica: "gramatica",
};

export function errorsOf(exercise: Exercise, result: ExerciseResult): ErrorRecord[] {
  if (result.status !== "graded" || result.verdict === "correct") return [];
  const focus = exercise.focus || exercise.skill;
  if (exercise.type === "choice" || exercise.type === "fill") {
    const accentOnly = exercise.type === "fill" && result.verdict === "partial";
    return [{
      category: accentOnly ? "acentuacion" : SKILL_CATEGORY[exercise.skill],
      focus,
      wrong: givenAnswer(exercise, result.answer),
      correct: expectedAnswer(exercise),
      explanation: exercise.explanation,
    }];
  }
  if (result.notes && result.notes.length > 0) {
    return result.notes.map((note) => ({ category: note.category, focus, wrong: note.fragment, correct: note.correction, explanation: note.explanation }));
  }
  return [{
    category: SKILL_CATEGORY[exercise.skill],
    focus,
    wrong: String(result.answer),
    correct: result.corrected || exercise.reference,
    explanation: result.feedback ?? "",
  }];
}
