import { useState } from "react";
import { MessageCircleQuestion, Send, X } from "lucide-react";
import type { PendingQuestion } from "../../lib/types";

interface QuestionPanelProps {
  execId: string;
  question: PendingQuestion;
  targetName: string;
  onSubmit: (execId: string, answer: string) => void;
  onDismiss: (execId: string) => void;
}

export function QuestionPanel({ execId, question, targetName, onSubmit, onDismiss }: QuestionPanelProps) {
  const [selected, setSelected] = useState<Map<number, Set<number>>>(new Map());
  const [customInputs, setCustomInputs] = useState<Map<number, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const toggleOption = (qIdx: number, optIdx: number, multi: boolean) => {
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
        if (customInputs.has(qIdx)) {
          const ci = new Map(customInputs);
          ci.delete(qIdx);
          setCustomInputs(ci);
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

  const buildAnswer = (): string => {
    const parts: string[] = [];
    for (let qIdx = 0; qIdx < question.questions.length; qIdx++) {
      const q = question.questions[qIdx];
      const custom = customInputs.get(qIdx);
      if (custom?.trim()) {
        parts.push(custom.trim());
        continue;
      }
      const sel = selected.get(qIdx);
      if (sel && sel.size > 0) {
        const labels = Array.from(sel).map((i) => q.options[i]?.label).filter(Boolean);
        parts.push(labels.join(", "));
      }
    }
    return parts.join("\n");
  };

  const canSubmit = question.questions.every((_, qIdx) => {
    const custom = customInputs.get(qIdx);
    if (custom?.trim()) return true;
    const sel = selected.get(qIdx);
    return sel && sel.size > 0;
  });

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      onSubmit(execId, buildAnswer());
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-accent/40 bg-accent/5 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-accent">
          <MessageCircleQuestion size={18} />
          <span className="text-sm font-medium">
            Claude precisa de uma resposta
          </span>
          <span className="text-xs text-text-muted">({targetName})</span>
        </div>
        <button
          onClick={() => onDismiss(execId)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Ignorar"
        >
          <X size={14} />
        </button>
      </div>

      {question.questions.map((q, qIdx) => (
        <div key={qIdx} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted uppercase bg-surface px-1.5 py-0.5 rounded">
              {q.header}
            </span>
            <p className="text-sm text-text-primary">{q.question}</p>
          </div>

          <div className="grid gap-1.5">
            {q.options.map((opt, optIdx) => {
              const isSelected = selected.get(qIdx)?.has(optIdx) ?? false;
              const hasCustom = !!customInputs.get(qIdx)?.trim();
              return (
                <button
                  key={optIdx}
                  onClick={() => toggleOption(qIdx, optIdx, q.multiSelect)}
                  className={`text-left px-3 py-2 rounded-md border text-sm transition-colors ${
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
                placeholder="Ou digite uma resposta personalizada..."
                value={customInputs.get(qIdx) ?? ""}
                onChange={(e) => setCustom(qIdx, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) handleSubmit();
                }}
                className="w-full px-3 py-1.5 rounded-md border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          <Send size={14} />
          {submitting ? "Enviando..." : "Responder"}
        </button>
      </div>
    </div>
  );
}
