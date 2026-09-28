import { MessageCircleQuestionMark } from "lucide-react";

export function NeedsAnswerBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="needs-answer-badge" role="status" title="Pergunta aguardando sua resposta">
      <MessageCircleQuestionMark size={12} aria-hidden="true" />
      {!compact && "Responder"}
    </span>
  );
}
