import { useState } from "react";
import { CircleAlert, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { questionDraftKey, readDraft, writeDraft } from "./drafts";
import { Markdown } from "./Markdown";
import type { QuestionView } from "./types";

const MAX_QUESTIONS = 6;
const MAX_CHARS = 1000;

interface Props {
  lessonId: string;
  step: number;
  questions: QuestionView[];
  busy: boolean;
  onAsk: (question: string) => Promise<boolean>;
}

function Answer({ question }: { question: QuestionView }) {
  if (question.status === "pending") {
    return <p className="espanol-answer is-pending" role="status"><Loader2 size={14} className="animate-spin" aria-hidden="true" />O professor está respondendo…</p>;
  }
  if (question.status === "failed") {
    return <p className="espanol-answer is-failed" role="alert"><CircleAlert size={14} aria-hidden="true" />Não consegui responder agora: {question.error} Pergunte de novo.</p>;
  }
  return <Markdown text={question.answer ?? ""} className="espanol-answer" />;
}

export function AskTeacher({ lessonId, step, questions, busy, onAsk }: Props) {
  const draftKey = questionDraftKey(lessonId, step);
  const [text, setText] = useState(() => readDraft(draftKey));
  const [open, setOpen] = useState(() => questions.length > 0 || text !== "");
  const pending = questions.some((question) => question.status === "pending");
  const full = questions.length >= MAX_QUESTIONS;

  const change = (value: string) => {
    setText(value);
    writeDraft(draftKey, value);
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const question = text.trim();
    if (!question || pending || busy) return;
    if (await onAsk(question)) change("");
  };

  return (
    <section className="espanol-ask" aria-label="Dúvidas com o professor">
      {questions.length > 0 && (
        <ol className="espanol-thread">
          {questions.map((question, i) => (
            <li key={i}>
              <p className="espanol-question">{question.question}</p>
              <Answer question={question} />
            </li>
          ))}
        </ol>
      )}
      {!open && (
        <button type="button" className="play-button is-ghost espanol-ask-toggle" onClick={() => setOpen(true)}>
          <MessageCircleQuestion size={15} aria-hidden="true" />Tirar uma dúvida com o professor
        </button>
      )}
      {open && !full && (
        <form className="espanol-ask-form" onSubmit={submit}>
          <textarea
            value={text}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(); }}
            placeholder="Pergunte o que não ficou claro nesta etapa…"
            aria-label="Sua dúvida"
            maxLength={MAX_CHARS}
            rows={2}
            disabled={pending}
          />
          <button type="submit" className="play-button" disabled={!text.trim() || pending || busy}>
            <Send size={15} aria-hidden="true" />Perguntar
          </button>
        </form>
      )}
      {full && <p className="espanol-muted">Você já fez o máximo de perguntas nesta etapa.</p>}
    </section>
  );
}
