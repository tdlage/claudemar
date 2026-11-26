import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronLeft, ChevronRight, CircleAlert, Flame, GraduationCap, Languages, Loader2, Map as MapIcon, RotateCcw, X } from "lucide-react";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { ExerciseStep, ExplanationStep, LessonSummary, ReadingStep, VocabularyStep } from "./LessonSteps";
import { CourseSheet, VocabularySheet } from "./SpanishSheets";
import { stopSpeaking } from "./speech";
import type { CourseState, StepView, Unavailable } from "./types";
import { useSpanishCourse, type SpanishActions } from "./useSpanishCourse";

interface Props {
  execId: string;
  hidden: boolean;
  activity?: string;
  onClose: () => void;
  onUnavailable: (reason: Unavailable) => void;
}

type Panel = "course" | "vocabulary" | null;

interface ToolProps {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Tool({ label, pressed, disabled, onClick, children }: ToolProps) {
  return (
    <button type="button" className="play-tool" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Welcome({ busy, onStart }: { busy: boolean; onStart: () => void }) {
  return (
    <article className="espanol-card espanol-welcome">
      <div className="play-card-icon" aria-hidden="true"><Languages size={26} /></div>
      <h2>Aula de espanhol</h2>
      <p>Um curso do A2 avançado ao B2, feito para quem fala português e quer passar no DELE B2.</p>
      <ul>
        <li><strong>Vocabulário</strong> que cresce a cada aula, com revisão espaçada das palavras que você aprendeu.</li>
        <li><strong>Conectores</strong> do discurso e <strong>conjugação</strong> de todos os tempos, do indicativo ao subjuntivo.</li>
        <li>O que o português tem de <strong>parecido</strong> para acelerar, e as armadilhas: <strong>ser e estar</strong>, falsos amigos, gêneros trocados.</li>
      </ul>
      <p className="espanol-muted">O Opus 5.5 monta o plano e cada aula sob medida para os seus erros. A primeira preparação leva alguns minutos e continua mesmo com a janela fechada.</p>
      <button type="button" className="play-button is-primary" onClick={onStart} disabled={busy} autoFocus>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <GraduationCap size={16} aria-hidden="true" />}Começar o curso
      </button>
    </article>
  );
}

function Preparing({ title, detail, error, busy, onRetry }: { title: string; detail: string; error: string | null; busy: boolean; onRetry: () => void }) {
  return (
    <div className="espanol-preparing" role="status">
      {error ? <CircleAlert size={22} aria-hidden="true" className="espanol-preparing-error" /> : <Loader2 size={22} className="animate-spin" aria-hidden="true" />}
      <strong>{error ? "Não consegui preparar" : title}</strong>
      <p>{error ?? detail}</p>
      {error && (
        <button type="button" className="play-button is-primary" onClick={onRetry} disabled={busy}><RotateCcw size={15} aria-hidden="true" />Tentar de novo</button>
      )}
    </div>
  );
}

function stepLabel(step: StepView): string {
  switch (step.kind) {
    case "explanation": return "Explicação";
    case "vocabulary": return "Vocabulário";
    case "reading": return "Leitura";
    case "exercise": return `Exercício ${step.exercise.index + 1}`;
  }
}

interface LessonBodyProps {
  state: CourseState;
  viewing: number;
  busy: boolean;
  actions: SpanishActions;
  onCourse: () => void;
}

function LessonBody({ state, viewing, busy, actions, onCourse }: LessonBodyProps) {
  const lesson = state.lesson!;
  if (lesson.completed) {
    return <LessonSummary lesson={lesson} course={state.course!} next={state.next} busy={busy} onNext={actions.next} onRetry={actions.retry} onCourse={onCourse} />;
  }
  const step = lesson.steps[viewing];
  const current = viewing === lesson.cursor;
  const proceed = () => actions.proceed(lesson.id, lesson.cursor);
  const key = `${lesson.id}:${viewing}`;
  switch (step.kind) {
    case "explanation": return <ExplanationStep key={key} step={step} busy={busy} current={current} onContinue={proceed} />;
    case "vocabulary": return <VocabularyStep key={key} step={step} busy={busy} current={current} onContinue={proceed} />;
    case "reading": return <ReadingStep key={key} step={step} busy={busy} current={current} onContinue={proceed} />;
    case "exercise":
      return (
        <ExerciseStep
          key={key}
          lesson={lesson}
          exercise={step.exercise}
          busy={busy}
          current={current}
          onAnswer={(answer) => actions.answer(lesson.id, step.exercise.index, answer)}
          onAppeal={() => actions.appeal(lesson.id, step.exercise.index)}
          onContinue={proceed}
        />
      );
  }
}

export function SpanishLesson({ execId, hidden, activity, onClose, onUnavailable }: Props) {
  const visible = !hidden;
  const { state, busy, error, timeZone, actions, dismissError } = useSpanishCourse(execId, visible, onUnavailable);
  const [panel, setPanel] = useState<Panel>(null);
  const [browsing, setBrowsing] = useState<{ lessonId: string; index: number } | null>(null);
  const windowRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lesson = state?.status === "lesson" ? state.lesson : null;
  const viewing = lesson && browsing?.lessonId === lesson.id && browsing.index < lesson.cursor ? browsing.index : lesson?.cursor ?? 0;

  useDialogFocus(windowRef, visible, () => {
    if (panel) setPanel(null);
    else onClose();
  });

  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, [lesson?.id, viewing]);

  const browse = useCallback((index: number) => {
    if (lesson) setBrowsing({ lessonId: lesson.id, index });
  }, [lesson]);

  const choose = (slot: { unit: number; step: number }) => {
    setPanel(null);
    actions.goTo(slot);
  };

  const course = state?.course ?? null;
  const ready = state !== null && state.status !== "welcome" && state.status !== "preparing-course";

  return createPortal(
    <div className="play-layer" hidden={hidden}>
      <section ref={windowRef} className="play-window espanol-window" role="dialog" aria-modal="true" aria-label="Aula de espanhol" tabIndex={-1}>
        <div className="play-ambient" aria-hidden="true"><span /><span /><span /></div>
        <header className="play-header">
          <div className="play-brand"><Languages size={18} aria-hidden="true" /><span>Español</span></div>
          {course && (
            <div className="espanol-position">
              <span className="espanol-level">{course.unit.level}</span>
              <strong lang="es">{course.unit.titleEs}</strong>
              <span>Unidade {course.current.unit} de {course.totalUnits} · aula {course.current.step} de {course.lessonsPerUnit}</span>
              {course.streakDays > 0 && <span className="espanol-streak" title="Dias seguidos com aula concluída"><Flame size={13} aria-hidden="true" />{course.streakDays}</span>}
            </div>
          )}
          <div className="play-activity" title="A execução continua enquanto você estuda">
            <span className="status-dot is-running" aria-hidden="true" />
            <span>Trabalhando{activity ? <> · <code>{activity}</code></> : "…"}</span>
          </div>
          <div className="play-tools">
            <Tool label="Mapa do curso" pressed={panel === "course"} disabled={!ready} onClick={() => setPanel(panel === "course" ? null : "course")}>
              <MapIcon size={17} aria-hidden="true" />
            </Tool>
            <Tool label="Vocabulário" pressed={panel === "vocabulary"} disabled={!ready} onClick={() => setPanel(panel === "vocabulary" ? null : "vocabulary")}>
              <BookOpen size={17} aria-hidden="true" />
            </Tool>
            <Tool label="Fechar a aula" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </Tool>
          </div>
        </header>

        <div className="play-stage espanol-stage">
          <div ref={stageRef} className="espanol-scroll">
            {!state && <div className="play-loading" role="status"><Loader2 size={18} className="animate-spin" aria-hidden="true" />Abrindo a aula…</div>}
            {state?.status === "welcome" && <Welcome busy={busy} onStart={actions.start} />}
            {state?.status === "preparing-course" && (
              <Preparing title="Montando seu curso do A2+ ao B2" detail="O plano completo, com as unidades, os tempos verbais, os conectores e as armadilhas do português, leva alguns minutos." error={state.error} busy={busy} onRetry={actions.retry} />
            )}
            {state?.status === "preparing-lesson" && course && (
              <Preparing title={`Preparando a aula ${course.current.step} da unidade ${course.current.unit}`} detail="A aula é montada para você, com as palavras que precisam de revisão e os seus erros recentes." error={state.error} busy={busy} onRetry={actions.retry} />
            )}
            {lesson && (
              <>
                {!lesson.completed && (
                  <header className="espanol-lesson-head">
                    <p>{lesson.role}</p>
                    <h1 lang="es">{lesson.title}</h1>
                    {lesson.goal && <span>{lesson.goal}</span>}
                  </header>
                )}
                <LessonBody state={state!} viewing={viewing} busy={busy} actions={actions} onCourse={() => setPanel("course")} />
              </>
            )}
          </div>
          {panel === "course" && <CourseSheet timeZone={timeZone} busy={busy} onChoose={choose} onClose={() => setPanel(null)} />}
          {panel === "vocabulary" && <VocabularySheet timeZone={timeZone} onClose={() => setPanel(null)} />}
          {error && <button type="button" className="play-error espanol-error" role="alert" onClick={dismissError} title="Fechar">{error}</button>}
        </div>

        {lesson && !lesson.completed && (
          <footer className="play-footer espanol-footer">
            <button type="button" className="play-tool" onClick={() => browse(viewing - 1)} disabled={viewing === 0} aria-label="Etapa anterior" title="Rever a etapa anterior">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <ol className="espanol-progress" aria-label="Etapas da aula">
              {lesson.steps.map((step, i) => {
                const result = step.kind === "exercise" ? step.exercise.result : null;
                const tone = result?.status === "graded" ? ` is-${result.verdict}` : "";
                return (
                  <li key={i}>
                    <button
                      type="button"
                      className={`${i < lesson.cursor ? "is-done" : ""}${i === viewing ? " is-viewing" : ""}${tone}`}
                      disabled={i > lesson.cursor}
                      onClick={() => browse(i)}
                      aria-label={`Etapa ${i + 1}: ${stepLabel(step)}${i === lesson.cursor ? ", atual" : ""}`}
                      aria-current={i === viewing ? "step" : undefined}
                    />
                  </li>
                );
              })}
            </ol>
            <button type="button" className="play-tool" onClick={() => browse(viewing + 1)} disabled={viewing >= lesson.cursor} aria-label="Próxima etapa" title="Avançar até a etapa atual">
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <span className="espanol-progress-label">{Math.min(viewing + 1, lesson.steps.length)} de {lesson.steps.length}</span>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
