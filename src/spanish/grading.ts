import type { Verdict } from "./types.js";

const EDGE_PUNCTUATION = /^[\s¿¡"'«»“”‘’.,;:!?()-]+|[\s¿¡"'«»“”‘’.,;:!?()-]+$/g;
const STRIPPED_MARKS = /[̀́̈]/g;

export function normalizeAnswer(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(EDGE_PUNCTUATION, "");
}

function withoutAccents(value: string): string {
  return value.normalize("NFD").replace(STRIPPED_MARKS, "").normalize("NFC");
}

export interface LocalGrade {
  verdict: Verdict;
  score: number;
}

export function gradeFill(accepted: readonly string[], given: string): LocalGrade {
  const answer = normalizeAnswer(given);
  const expected = accepted.map(normalizeAnswer);
  if (expected.includes(answer)) return { verdict: "correct", score: 1 };
  const bare = withoutAccents(answer);
  if (expected.some((option) => withoutAccents(option) === bare)) return { verdict: "partial", score: 0.5 };
  return { verdict: "incorrect", score: 0 };
}

export function gradeChoice(answer: number, given: number): LocalGrade {
  return answer === given ? { verdict: "correct", score: 1 } : { verdict: "incorrect", score: 0 };
}

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
}
