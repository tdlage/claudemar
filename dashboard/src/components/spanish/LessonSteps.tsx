import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BookOpenText, CircleAlert, CircleCheck, CircleX, Flame, GraduationCap, Languages, Loader2, Map as MapIcon, MessageSquareQuote, RotateCcw, Scale, Send, Sparkles, Volume2,
} from "lucide-react";
import { CONTRAST_LABELS, percent, plural, SKILL_LABELS, VERDICT_LABELS } from "./labels";
import { renderMarkdown } from "./markdown";
import { canSpeak, speak } from "./speech";
import type { CourseSummary, ExerciseView, LessonView, NextView, ResultView, StepView, Translated, VocabularyEntry } from "./types";

const BLANK = "___";

export function SpeakButton({ text, label = "Ouvir em espanhol" }: { text: string; label?: string }) {
  if (!canSpeak()) return null;
  return (
    <button type="button" className="espanol-speak" onClick={() => speak(text)} aria-label={label} title={label}>
      <Volume2 size={14} aria-hidden="true" />
    </button>
  );
}

function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`espanol-markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Examples({ items }: { items: Translated[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="espanol-examples">
      {items.map((item) => (
        <li key={item.es}>
          <span className="espanol-es" lang="es">{item.es}<SpeakButton text={item.es} /></span>
          <span className="espanol-pt">{item.pt}</span>
        </li>
      ))}
    </ul>
  );
}

function ContinueButton({ onClick, busy, label = "Continuar" }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" className="play-button is-primary espanol-continue" onClick={onClick} disabled={busy} autoFocus>
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
      {label}
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}

interface CardProps {
  busy: boolean;
  current: boolean;
  onContinue: () => void;
}

export function ExplanationStep({ step, busy, current, onContinue }: CardProps & { step: Extract<StepView, { kind: "explanation" }> }) {
  return (
    <article className="espanol-card">
      <p className="espanol-eyebrow"><GraduationCap size={14} aria-hidden="true" />Explicação</p>
      <h2>{step.title}</h2>
      <Markdown text={step.body} />
      <Examples items={step.examples} />
      {current && <ContinueButton onClick={onContinue} busy={busy} />}
    </article>
  );
}

function WordCard({ word }: { word: VocabularyEntry }) {
  const contrast = CONTRAST_LABELS[word.contrast];
  return (
    <li className={`espanol-word${word.contrast === "falso_amigo" ? " is-false-friend" : ""}`}>
      <div className="espanol-word-head">
        <strong lang="es">{word.display}</strong>
        <SpeakButton text={word.display} />
        {contrast && <span className={`espanol-badge is-${word.contrast}`}>{contrast}</span>}
      </div>
      <p className="espanol-word-meaning">{word.translation}{word.partOfSpeech && <small> · {word.partOfSpeech}</small>}</p>
      {word.exampleEs && <p className="espanol-word-example" lang="es">{word.exampleEs}</p>}
      {word.examplePt && <p className="espanol-pt">{word.examplePt}</p>}
      {word.note && <p className="espanol-word-note"><CircleAlert size={13} aria-hidden="true" />{word.note}</p>}
    </li>
  );
}

export function VocabularyStep({ step, busy, current, onContinue }: CardProps & { step: Extract<StepView, { kind: "vocabulary" }> }) {
  return (
    <article className="espanol-card is-wide">
      <p className="espanol-eyebrow"><Languages size={14} aria-hidden="true" />{plural(step.words.length, "palavra nova", "palavras novas")}</p>
      <h2>Vocabulário da aula</h2>
      <p className="espanol-muted">Leia com atenção: estas palavras entram na sua revisão espaçada e voltam nos exercícios.</p>
      <ul className="espanol-words">
        {step.words.map((word) => <WordCard key={word.lemma} word={word} />)}
      </ul>
      {current && <ContinueButton onClick={onContinue} busy={busy} label="Já li, continuar" />}
    </article>
  );
}

export function ReadingStep({ step, busy, current, onContinue }: CardProps & { step: Extract<StepView, { kind: "reading" }> }) {
  return (
    <article className="espanol-card">
      <p className="espanol-eyebrow"><BookOpenText size={14} aria-hidden="true" />Leitura</p>
      <h2 lang="es">{step.title}<SpeakButton text={`${step.title}. ${step.text}`} label="Ouvir o texto" /></h2>
      <Markdown text={step.text} className="espanol-reading" />
      {step.glossary.length > 0 && (
        <dl className="espanol-glossary">
          {step.glossary.map((item) => (
            <div key={item.es}><dt lang="es">{item.es}</dt><dd>{item.pt}</dd></div>
          ))}
        </dl>
      )}
      {current && <ContinueButton onClick={onContinue} busy={busy} />}
    </article>
  );
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
}

interface ExerciseProps {
  lesson: LessonView;
  exercise: ExerciseView;
  busy: boolean;
  current: boolean;
  onAnswer: (answer: string | number) => void;
  onAppeal: () => void;
  onContinue: () => void;
}

function Verdict({ result }: { result: ResultView }) {
  const verdict = result.verdict ?? "incorrect";
  const icon = verdict === "correct" ? <CircleCheck size={18} aria-hidden="true" /> : verdict === "partial" ? <CircleAlert size={18} aria-hidden="true" /> : <CircleX size={18} aria-hidden="true" />;
  return <p className={`espanol-verdict is-${verdict}`}>{icon}{VERDICT_LABELS[verdict]}{typeof result.score === "number" && result.score > 0 && result.score < 1 ? <small>{percent(result.score)}</small> : null}</p>;
}

function Appeal({ result, busy, onAppeal }: { result: ResultView; busy: boolean; onAppeal: () => void }) {
  if (result.appeal === "pending") {
    return <p className="espanol-appeal" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" />Revisando sua resposta…</p>;
  }
  return (
    <>
      {result.appealNote && (
        <p className={`espanol-appeal is-${result.appeal}`}><Scale size={14} aria-hidden="true" />
          {result.appeal === "accepted" ? "Revisão: sua resposta foi aceita. " : result.appeal === "rejected" ? "Revisão: a resposta continua incorreta. " : "Não consegui revisar agora. "}
          {result.appealNote}
        </p>
      )}
      {result.canAppeal && (
        <button type="button" className="play-button is-ghost espanol-appeal-button" onClick={onAppeal} disabled={busy}>
          <Scale size={15} aria-hidden="true" />Minha resposta também está certa?
        </button>
      )}
    </>
  );
}

function Feedback({ exercise, result, busy, onAppeal }: { exercise: ExerciseView; result: ResultView; busy: boolean; onAppeal: () => void }) {
  const open = exercise.type === "translate" || exercise.type === "write";
  return (
    <section className={`espanol-feedback is-${result.verdict ?? "incorrect"}`} aria-live="polite">
      <Verdict result={result} />
      {!open && result.verdict !== "correct" && (
        <p className="espanol-expected">Resposta: <strong lang="es">{result.expected}</strong><SpeakButton text={result.expected} /></p>
      )}
      {result.feedback && <p>{result.feedback}</p>}
      {!open && result.explanation && <p className="espanol-muted">{result.explanation}</p>}
      {open && result.corrected && result.verdict !== "correct" && (
        <div className="espanol-correction"><span>Sua resposta corrigida</span><p lang="es">{result.corrected}</p></div>
      )}
      {open && result.notes && result.notes.length > 0 && (
        <ul className="espanol-notes">
          {result.notes.map((note, i) => (
            <li key={`${note.fragment}:${i}`}>
              <span><s lang="es">{note.fragment}</s> → <strong lang="es">{note.correction}</strong></span>
              {note.explanation && <small>{note.explanation}</small>}
            </li>
          ))}
        </ul>
      )}
      {open && result.improved && (
        <div className="espanol-correction is-improved"><span><Sparkles size={13} aria-hidden="true" />Versão mais natural</span><p lang="es">{result.improved}<SpeakButton text={result.improved} /></p></div>
      )}
      {open && result.explanation && <p className="espanol-muted">{result.explanation}</p>}
      {exercise.type === "fill" && <Appeal result={result} busy={busy} onAppeal={onAppeal} />}
    </section>
  );
}

function FillPrompt({ prompt, value, disabled, verdict, onChange, inputRef }: {
  prompt: string;
  value: string;
  disabled: boolean;
  verdict?: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [before, after] = prompt.split(BLANK);
  return (
    <p className="espanol-prompt" lang="es">
      {before}
      <input
        ref={inputRef}
        className={`espanol-blank${verdict ? ` is-${verdict}` : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label="Resposta da lacuna"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        size={Math.max(6, value.length + 1)}
      />
      {after}
    </p>
  );
}

function Prompt({ text }: { text: string }) {
  const parts = text.split(BLANK);
  return (
    <p className="espanol-prompt" lang="es">
      {parts.map((part, i) => <span key={i}>{part}{i < parts.length - 1 && <span className="espanol-gap" aria-label="lacuna">____</span>}</span>)}
    </p>
  );
}

export function ExerciseStep({ lesson, exercise, busy, current, onAnswer, onAppeal, onContinue }: ExerciseProps) {
  const result = exercise.result;
  const initial = typeof result?.answer === "string" ? result.answer : "";
  const [text, setText] = useState(initial);
  const [choice, setChoice] = useState<number | null>(typeof result?.answer === "number" ? result.answer : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const answered = result !== null && result.status !== "failed";
  const editable = current && !answered && !busy;
  const words = countWords(text);

  useEffect(() => {
    if (!current || answered) return;
    inputRef.current?.focus({ preventScroll: true });
    areaRef.current?.focus({ preventScroll: true });
  }, [current, answered]);

  useEffect(() => {
    if (!editable || exercise.type !== "choice") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea"))) return;
      if (event.key === "Enter" && choice !== null && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        onAnswer(choice);
        return;
      }
      const option = Number(event.key) - 1;
      if (Number.isInteger(option) && option >= 0 && option < (exercise.options?.length ?? 0)) {
        event.preventDefault();
        setChoice(option);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, exercise.type, exercise.options, choice, onAnswer]);

  const ready = exercise.type === "choice" ? choice !== null : text.trim().length > 0;
  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!editable || !ready) return;
    onAnswer(exercise.type === "choice" ? choice! : text.trim());
  };

  return (
    <article className="espanol-card">
      <p className="espanol-eyebrow">
        <MessageSquareQuote size={14} aria-hidden="true" />
        {SKILL_LABELS[exercise.skill]}{exercise.focus && <span> · {exercise.focus}</span>}
      </p>
      <h2 className="espanol-instruction">{exercise.instruction}</h2>
      <form onSubmit={submit} className="espanol-exercise">
        {exercise.type === "choice" && (
          <>
            <Prompt text={exercise.prompt ?? ""} />
            <div className="espanol-options" role="radiogroup" aria-label="Opções">
              {exercise.options!.map((option, i) => {
                const state = result?.status === "graded"
                  ? i === result.correctOption ? "is-correct" : i === result.answer ? "is-wrong" : "is-dim"
                  : i === choice ? "is-selected" : "";
                return (
                  <button key={option} type="button" role="radio" aria-checked={i === choice} className={`espanol-option ${state}`} disabled={!editable} onClick={() => setChoice(i)}>
                    <kbd>{i + 1}</kbd><span lang="es">{option}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {exercise.type === "fill" && (
          <>
            <FillPrompt prompt={exercise.prompt ?? ""} value={text} disabled={!editable} verdict={result?.status === "graded" ? result.verdict : undefined} onChange={setText} inputRef={inputRef} />
            {exercise.hint && <p className="espanol-hint">{exercise.hint}</p>}
          </>
        )}
        {exercise.type === "translate" && (
          <>
            <blockquote className="espanol-source">{exercise.source}</blockquote>
            <textarea
              ref={areaRef}
              className="espanol-textarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(); }}
              disabled={!editable}
              rows={3}
              lang="es"
              placeholder="Escreva em espanhol…"
              aria-label="Sua tradução"
            />
          </>
        )}
        {exercise.type === "write" && (
          <>
            <p className="espanol-task">{exercise.task}</p>
            {exercise.requirements && exercise.requirements.length > 0 && (
              <ul className="espanol-requirements">{exercise.requirements.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
            <textarea
              ref={areaRef}
              className="espanol-textarea is-long"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(); }}
              disabled={!editable}
              rows={8}
              lang="es"
              placeholder="Escreva em espanhol…"
              aria-label="Seu texto"
            />
            <p className={`espanol-word-count${exercise.minWords && words < exercise.minWords ? " is-short" : exercise.maxWords && words > exercise.maxWords ? " is-long" : ""}`}>
              {plural(words, "palavra", "palavras")} · de {exercise.minWords} a {exercise.maxWords}
            </p>
          </>
        )}

        {result?.status === "grading" && (
          <p className="espanol-grading" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />O professor está corrigindo sua resposta…</p>
        )}
        {result?.status === "failed" && (
          <p className="espanol-failure" role="alert"><CircleAlert size={15} aria-hidden="true" />Não consegui corrigir: {result.error} Envie de novo.</p>
        )}
        {current && !answered && (
          <button type="submit" className="play-button is-primary espanol-continue" disabled={!editable || !ready}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
            {result?.status === "failed" ? "Enviar de novo" : "Verificar"}
          </button>
        )}
      </form>

      {result?.status === "graded" && <Feedback exercise={exercise} result={result} busy={busy} onAppeal={onAppeal} />}
      {current && result?.status === "graded" && (
        <ContinueButton onClick={onContinue} busy={busy || result.appeal === "pending"} label={lesson.cursor === lesson.steps.length - 1 ? "Concluir a aula" : "Continuar"} />
      )}
    </article>
  );
}

interface SummaryProps {
  lesson: LessonView;
  course: CourseSummary;
  next: NextView | null;
  busy: boolean;
  onNext: () => void;
  onRetry: () => void;
  onCourse: () => void;
}

export function LessonSummary({ lesson, course, next, busy, onNext, onRetry, onCourse }: SummaryProps) {
  const exercises = lesson.steps.flatMap((step) => step.kind === "exercise" ? [step.exercise] : []);
  const correct = exercises.filter((exercise) => exercise.result?.verdict === "correct").length;
  const words = lesson.steps.reduce((sum, step) => sum + (step.kind === "vocabulary" ? step.words.length : 0), 0);
  return (
    <div className="play-modal">
      <section className="play-card espanol-summary" role="alertdialog" aria-label="Aula concluída">
        <div className="play-card-icon" aria-hidden="true"><Sparkles size={26} /></div>
        <h2>Aula concluída!</h2>
        <p className="espanol-score">{percent(lesson.score ?? 0)}</p>
        <ul className="espanol-summary-stats">
          <li><CircleCheck size={15} aria-hidden="true" />{correct} de {exercises.length} exercícios certos</li>
          {words > 0 && <li><Languages size={15} aria-hidden="true" />{plural(words, "palavra nova", "palavras novas")} · {course.vocabulary.total} no total</li>}
          {course.streakDays > 0 && <li><Flame size={15} aria-hidden="true" />{plural(course.streakDays, "dia seguido", "dias seguidos")}</li>}
        </ul>
        <div className="play-card-actions">
          {next === null && <p className="espanol-muted">Você concluiu a última aula do curso. Pode refazer qualquer aula pelo mapa.</p>}
          {next && next.ready && (
            <button type="button" className="play-button is-primary" onClick={onNext} disabled={busy} autoFocus>Próxima aula<ArrowRight size={16} aria-hidden="true" /></button>
          )}
          {next && !next.ready && !next.error && (
            <button type="button" className="play-button is-primary" disabled><Loader2 size={16} className="animate-spin" aria-hidden="true" />Preparando a próxima aula…</button>
          )}
          {next?.error && (
            <>
              <p className="espanol-failure" role="alert"><CircleAlert size={15} aria-hidden="true" />{next.error}</p>
              <button type="button" className="play-button is-primary" onClick={onRetry} disabled={busy}><RotateCcw size={15} aria-hidden="true" />Tentar de novo</button>
            </>
          )}
          <button type="button" className="play-button is-ghost" onClick={onCourse}><MapIcon size={15} aria-hidden="true" />Ver o mapa do curso</button>
        </div>
      </section>
    </div>
  );
}
