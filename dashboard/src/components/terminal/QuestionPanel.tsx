import { useState } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";
import type { PendingQuestion } from "../../lib/types";

interface QuestionPanelProps {
  execId: string;
  question: PendingQuestion;
  targetName: string;
  runtime?: "codex" | "claude";
  onSubmit: (execId: string, answer: string, toolUseId?: string, answers?: Record<string, string>) => Promise<unknown>;
}

export function QuestionPanel({ execId, question, targetName, runtime, onSubmit }: QuestionPanelProps) {
  const [selected, setSelected] = useState<Map<number, Set<number>>>(new Map());
  const [customInputs, setCustomInputs] = useState<Map<number, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleOption = (qIdx: number, optIdx: number, multi: boolean) => {
    setCustomInputs((prev) => {
      const next = new Map(prev);
      next.delete(qIdx);
      return next;
    });
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(qIdx) ?? new Set<number>();
      if (multi) {
        const updated = new Set(current);
        if (updated.has(optIdx)) updated.delete(optIdx);
        else updated.add(optIdx);
        next.set(qIdx, updated);
      } else {
        if (current.has(optIdx) && current.size === 1) {
          next.delete(qIdx);
        } else {
          next.set(qIdx, new Set([optIdx]));
        }
      }
      return next;
    });
  };

  const setCustom = (qIdx: number, value: string) => {
    setCustomInputs((prev) => {
      const next = new Map(prev);
      next.set(qIdx, value);
      return next;
    });
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(qIdx);
      return next;
    });
  };

  const buildAnswers = (): Record<string, string> => {
    const parts: Array<[string, string]> = [];
    for (let qIdx = 0; qIdx < question.questions.length; qIdx++) {
      const q = question.questions[qIdx];
      const custom = customInputs.get(qIdx);
      if (custom?.trim()) {
        parts.push([q.question, custom.trim()]);
        continue;
      }
      const sel = selected.get(qIdx);
      if (sel && sel.size > 0) {
        const labels = Array.from(sel).map((i) => q.options[i]?.label).filter(Boolean);
        parts.push([q.question, labels.join(", ")]);
      }
    }
    return Object.fromEntries(parts);
  };

  const canSubmit = question.questions.length > 0 && question.questions.every((_, qIdx) => {
    const custom = customInputs.get(qIdx);
    if (custom?.trim()) return true;
    const sel = selected.get(qIdx);
    return sel && sel.size > 0;
  });

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = buildAnswers();
      const text = Object.entries(answers).map(([question, answer]) => `${question}\nResposta: ${answer}`).join("\n\n");
      await onSubmit(execId, text, question.toolUseId, answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar. Tente novamente.");
      setSubmitting(false);
    }
  };

  return (
    <section aria-label="Pergunta pendente" aria-busy={submitting} className="border border-accent/40 bg-surface rounded-lg p-4 space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-accent">
          <MessageCircleQuestion size={18} />
          <span className="text-sm font-medium">
            {runtime === "codex" ? "Codex" : runtime === "claude" ? "Claude" : "O agente"} precisa de uma resposta
          </span>
          <span className="text-xs text-text-muted">({targetName})</span>
        </div>
        <p className="text-xs text-text-secondary mt-1">A execução aguarda sua resposta para continuar com as informações corretas.</p>
      </div>

      {question.questions.map((q, qIdx) => (
        <fieldset key={qIdx} disabled={submitting} className="space-y-2 min-w-0">
          <legend className="space-y-1">
            <span className="text-xs font-medium text-text-muted uppercase bg-surface px-1.5 py-0.5 rounded">
              {q.header}
            </span>
            <span className="block text-sm text-text-primary">{q.question}</span>
          </legend>

          <div className="grid gap-1.5">
            {q.options.map((opt, optIdx) => {
              const isSelected = selected.get(qIdx)?.has(optIdx) ?? false;
              const hasCustom = !!customInputs.get(qIdx)?.trim();
              return (
                <button
                  key={optIdx}
                  type="button"
                  aria-pressed={isSelected && !hasCustom}
                  onClick={() => toggleOption(qIdx, optIdx, q.multiSelect)}
                  className={`text-left px-3 py-2 min-h-11 rounded-md border text-sm break-words transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                    isSelected && !hasCustom
                      ? "border-accent bg-accent/10 text-text-primary"
                      : "border-border bg-surface hover:border-border-hover hover:bg-surface-hover text-text-secondary"
                  }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-text-muted ml-1.5">— {opt.description}</span>
                  )}
                </button>
              );
            })}

            <div className="mt-1">
              <input
                type="text"
                aria-label={`Resposta personalizada: ${q.question}`}
                placeholder="Ou digite uma resposta personalizada..."
                value={customInputs.get(qIdx) ?? ""}
                onChange={(e) => setCustom(qIdx, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && canSubmit) void handleSubmit();
                }}
                className="w-full px-3 py-1.5 rounded-md border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </fieldset>
      ))}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-11 rounded-md text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Send size={14} />
          {submitting ? "Enviando..." : "Responder"}
        </button>
      </div>
    </section>
  );
}
