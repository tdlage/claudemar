import {
  CONTRASTS,
  ERROR_CATEGORIES,
  LEVELS,
  SKILLS,
  type AppealDecision,
  type Assessment,
  type CoursePlan,
  type CourseUnit,
  type Exercise,
  type Explanation,
  type LessonContent,
  type Reading,
  type Translated,
  type Verdict,
  type VocabularyEntry,
} from "./types.js";

type Schema = Record<string, unknown>;

const MIN_UNITS = 24;
const MAX_UNITS = 60;
const MIN_EXERCISES = 6;
const MAX_EXERCISES = 24;
const MAX_WRITE_WORDS = 400;
export const BLANK = "___";

const text: Schema = { type: "string" };
const textList: Schema = { type: "array", items: text };

function object(properties: Record<string, Schema>): Schema {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

const translated = object({ es: text, pt: text });

const exerciseBase = {
  skill: { type: "string", enum: [...SKILLS] },
  focus: text,
  instruction: text,
  explanation: text,
  lemmas: textList,
};

export const PLAN_SCHEMA = object({
  units: {
    type: "array",
    items: object({
      level: { type: "string", enum: [...LEVELS] },
      titleEs: text,
      titlePt: text,
      theme: text,
      grammar: textList,
      connectors: textList,
      contrasts: textList,
      dele: text,
    }),
  },
});

export const LESSON_SCHEMA = object({
  title: text,
  goal: text,
  explanation: object({ title: text, body: text, examples: { type: "array", items: translated } }),
  vocabulary: {
    type: "array",
    items: object({
      lemma: text,
      display: text,
      partOfSpeech: text,
      translation: text,
      exampleEs: text,
      examplePt: text,
      note: text,
      contrast: { type: "string", enum: [...CONTRASTS] },
    }),
  },
  reading: { anyOf: [{ type: "null" }, object({ title: text, text, glossary: { type: "array", items: translated } })] },
  exercises: {
    type: "array",
    items: {
      anyOf: [
        object({ type: { type: "string", enum: ["choice"] }, ...exerciseBase, prompt: text, options: textList, answer: { type: "integer" } }),
        object({ type: { type: "string", enum: ["fill"] }, ...exerciseBase, prompt: text, hint: text, answers: textList }),
        object({ type: { type: "string", enum: ["translate"] }, ...exerciseBase, source: text, reference: text }),
        object({
          type: { type: "string", enum: ["write"] },
          ...exerciseBase,
          task: text,
          requirements: textList,
          minWords: { type: "integer" },
          maxWords: { type: "integer" },
          reference: text,
        }),
      ],
    },
  },
});

export const ASSESSMENT_SCHEMA = object({
  verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
  score: { type: "number" },
  feedback: text,
  corrected: text,
  improved: text,
  notes: {
    type: "array",
    items: object({ fragment: text, correction: text, category: { type: "string", enum: [...ERROR_CATEGORIES] }, explanation: text }),
  },
});

export const APPEAL_SCHEMA = object({ accepted: { type: "boolean" }, explanation: text });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((item) => str(item, maxLength)).filter(Boolean);
  return [...new Set(items)].slice(0, maxItems);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function translations(value: unknown, maxItems: number): Translated[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ es: str(record(item).es, 600), pt: str(record(item).pt, 600) }))
    .filter((item) => item.es && item.pt)
    .slice(0, maxItems);
}

export function lemmaKey(lemma: string): string {
  return lemma.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parsePlan(raw: unknown): CoursePlan {
  const units = Array.isArray(record(raw).units) ? record(raw).units as unknown[] : [];
  const parsed = units.map((item): CourseUnit | null => {
    const unit = record(item);
    const titleEs = str(unit.titleEs, 160);
    const titlePt = str(unit.titlePt, 160);
    const theme = str(unit.theme, 300);
    if (!titleEs || !titlePt || !theme) return null;
    return {
      level: oneOf(unit.level, LEVELS, "B1"),
      titleEs,
      titlePt,
      theme,
      grammar: strings(unit.grammar, 8, 400),
      connectors: strings(unit.connectors, 12, 240),
      contrasts: strings(unit.contrasts, 8, 400),
      dele: str(unit.dele, 300),
    };
  }).filter((unit): unit is CourseUnit => unit !== null);
  if (parsed.length < MIN_UNITS) throw new Error(`O plano gerado tem ${parsed.length} unidades válidas; o mínimo é ${MIN_UNITS}.`);
  return { units: parsed.slice(0, MAX_UNITS) };
}

function parseVocabulary(value: unknown): VocabularyEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: VocabularyEntry[] = [];
  for (const item of value) {
    const entry = record(item);
    const lemma = str(entry.lemma, 80);
    const translation = str(entry.translation, 200);
    const key = lemmaKey(lemma);
    if (!lemma || !translation || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      lemma: key,
      display: str(entry.display, 120) || lemma,
      partOfSpeech: str(entry.partOfSpeech, 40),
      translation,
      exampleEs: str(entry.exampleEs, 400),
      examplePt: str(entry.examplePt, 400),
      note: str(entry.note, 400),
      contrast: oneOf(entry.contrast, CONTRASTS, "nenhum"),
    });
  }
  return entries.slice(0, 20);
}

function parseReading(value: unknown): Reading | null {
  const reading = record(value);
  const body = str(reading.text, 4000);
  if (!body) return null;
  return { title: str(reading.title, 160), text: body, glossary: translations(reading.glossary, 20) };
}

function withBlank(prompt: string): string | null {
  const normalized = prompt.replace(/_{2,}/g, BLANK);
  return normalized.split(BLANK).length === 2 ? normalized : null;
}

function parseExercise(value: unknown): Exercise | null {
  const item = record(value);
  const base = {
    skill: oneOf(item.skill, SKILLS, "gramatica"),
    focus: str(item.focus, 120),
    instruction: str(item.instruction, 400),
    explanation: str(item.explanation, 1200),
    lemmas: strings(item.lemmas, 12, 80).map(lemmaKey),
  };
  if (!base.instruction) return null;
  switch (item.type) {
    case "choice": {
      const prompt = str(item.prompt, 1200);
      const options = strings(item.options, 6, 300);
      const answer = item.answer;
      const valid = prompt && options.length >= 2 && options.length === (item.options as unknown[]).length
        && Number.isInteger(answer) && (answer as number) >= 0 && (answer as number) < options.length;
      return valid ? { type: "choice", ...base, prompt, options, answer: answer as number } : null;
    }
    case "fill": {
      const prompt = withBlank(str(item.prompt, 1200));
      const answers = strings(item.answers, 8, 120);
      return prompt && answers.length > 0 ? { type: "fill", ...base, prompt, hint: str(item.hint, 200), answers } : null;
    }
    case "translate": {
      const source = str(item.source, 1200);
      const reference = str(item.reference, 1200);
      return source && reference ? { type: "translate", ...base, source, reference } : null;
    }
    case "write": {
      const task = str(item.task, 1500);
      const reference = str(item.reference, 3000);
      const minWords = Number.isInteger(item.minWords) ? Math.max(1, item.minWords as number) : 0;
      const maxWords = Number.isInteger(item.maxWords) ? Math.min(MAX_WRITE_WORDS, item.maxWords as number) : 0;
      const valid = task && reference && minWords > 0 && maxWords >= minWords;
      return valid ? { type: "write", ...base, task, requirements: strings(item.requirements, 8, 200), minWords, maxWords, reference } : null;
    }
    default:
      return null;
  }
}

function parseExplanation(value: unknown): Explanation | null {
  const explanation = record(value);
  const title = str(explanation.title, 200);
  const body = str(explanation.body, 6000);
  return title && body ? { title, body, examples: translations(explanation.examples, 12) } : null;
}

export function parseLesson(raw: unknown): LessonContent {
  const lesson = record(raw);
  const title = str(lesson.title, 200);
  const explanation = parseExplanation(lesson.explanation);
  if (!title || !explanation) throw new Error("A aula gerada não tem título ou explicação.");
  const exercises = (Array.isArray(lesson.exercises) ? lesson.exercises : [])
    .map(parseExercise)
    .filter((exercise): exercise is Exercise => exercise !== null)
    .slice(0, MAX_EXERCISES);
  if (exercises.length < MIN_EXERCISES) throw new Error(`A aula gerada tem ${exercises.length} exercícios válidos; o mínimo é ${MIN_EXERCISES}.`);
  return {
    title,
    goal: str(lesson.goal, 600),
    explanation,
    vocabulary: parseVocabulary(lesson.vocabulary),
    reading: parseReading(lesson.reading),
    exercises,
  };
}

function clampScore(value: unknown, verdict: Verdict): number {
  const fallback = verdict === "correct" ? 1 : verdict === "partial" ? 0.5 : 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function parseAssessment(raw: unknown): Assessment {
  const assessment = record(raw);
  const verdict = oneOf<Verdict>(assessment.verdict, ["correct", "partial", "incorrect"], "incorrect");
  const feedback = str(assessment.feedback, 3000);
  if (!feedback) throw new Error("A correção veio sem comentário.");
  const notes = (Array.isArray(assessment.notes) ? assessment.notes : [])
    .map((item) => {
      const note = record(item);
      return {
        fragment: str(note.fragment, 300),
        correction: str(note.correction, 300),
        category: oneOf(note.category, ERROR_CATEGORIES, "gramatica"),
        explanation: str(note.explanation, 600),
      };
    })
    .filter((note) => note.fragment && note.correction)
    .slice(0, 12);
  return {
    verdict,
    score: clampScore(assessment.score, verdict),
    feedback,
    corrected: str(assessment.corrected, 4000),
    improved: str(assessment.improved, 4000),
    notes,
  };
}

export function parseAppeal(raw: unknown): AppealDecision {
  const decision = record(raw);
  const explanation = str(decision.explanation, 1200);
  if (typeof decision.accepted !== "boolean" || !explanation) throw new Error("A revisão veio incompleta.");
  return { accepted: decision.accepted, explanation };
}
