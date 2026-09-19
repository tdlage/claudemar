import { useState, type ReactNode } from "react";
import { History, MessageCircle } from "lucide-react";
import type { PendingQuestionEntry } from "../../hooks/useExecution";
import { QuestionPanel } from "./QuestionPanel";
import { Modal } from "../shared/Modal";

interface Props {
  questions: PendingQuestionEntry[];
  onAnswer: (id: string, text: string, questionId?: string, answers?: Record<string, string>) => Promise<unknown>;
  history: ReactNode;
  children: ReactNode;
}

export function ConversationWorkspace({ questions, onAnswer, history, children }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className={`conversation-workspace ${questions.length ? "has-questions" : ""}`}>
      <div className="conversation-stage">
        <div className="conversation-heading md:hidden">
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary"><MessageCircle size={16} />{questions.length ? "Sua resposta é necessária" : "Conversa"}</span>
          <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-2 text-sm text-text-secondary"><History size={17} />Histórico</button>
        </div>
        {questions.length > 0 && <div className="conversation-questions">
          {questions.map((pq) => <QuestionPanel key={`${pq.execId}:${pq.question.toolUseId}`} execId={pq.execId} question={pq.question} runtime={pq.info.runtime} targetName={pq.info.targetName} onSubmit={onAnswer} />)}
        </div>}
        <div className="conversation-terminal">{children}</div>
      </div>
      <div className="conversation-history hidden md:block">{history}</div>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Histórico da conversa" size="xl">
        {history}<p className="text-xs text-text-muted mt-4">As execuções anteriores ficam disponíveis aqui.</p>
      </Modal>
    </div>
  );
}
