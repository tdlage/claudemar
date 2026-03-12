import { useState, useEffect } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { AskQuestion } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  itemId: string;
  pendingQuestions: AskQuestion[] | null;
}

export function ReviewPlanModal({ open, onClose, itemId, pendingQuestions }: Props) {
  const { addToast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setPrompt("");
      setAnswers({});
    }
  }, [open]);

  const toggleAnswer = (qIdx: number, optLabel: string, multi: boolean) => {
    setAnswers((prev) => {
      const current = prev[qIdx] ?? [];
      if (multi) {
        return {
          ...prev,
          [qIdx]: current.includes(optLabel)
            ? current.filter((a) => a !== optLabel)
            : [...current, optLabel],
        };
      }
      return { ...prev, [qIdx]: [optLabel] };
    });
  };

  const handleSend = async () => {
    if (sending) return;

    let finalPrompt = "";

    if (pendingQuestions && pendingQuestions.length > 0) {
      const answerParts: string[] = [];
      for (let i = 0; i < pendingQuestions.length; i++) {
        const q = pendingQuestions[i];
        const selected = answers[i] ?? [];
        if (selected.length > 0) {
          answerParts.push(`${q.question}\nResposta: ${selected.join(", ")}`);
        }
      }
      if (answerParts.length > 0) {
        finalPrompt += answerParts.join("\n\n") + "\n\n";
      }
    }

    if (prompt.trim()) {
      finalPrompt += prompt.trim();
    }

    if (!finalPrompt.trim()) {
      addToast("error", "Please provide a prompt or answer the questions");
      return;
    }

    setSending(true);
    try {
      await api.post(`/tracker/items/${itemId}/review-plan`, { prompt: finalPrompt });
      addToast("success", "Review prompt sent");
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Review Plan">
      <div className="space-y-4">
        {pendingQuestions && pendingQuestions.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider">Questions from Claude</div>
            {pendingQuestions.map((q, qIdx) => (
              <div key={qIdx} className="border border-border rounded-md p-3">
                <div className="text-sm text-text-primary mb-2">{q.question}</div>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((opt, oIdx) => {
                    const selected = (answers[qIdx] ?? []).includes(opt.label);
                    return (
                      <button
                        key={oIdx}
                        onClick={() => toggleAnswer(qIdx, opt.label, q.multiSelect)}
                        className={`px-2.5 py-1 rounded text-xs transition-colors ${
                          selected
                            ? "bg-accent/20 text-accent border border-accent/40"
                            : "bg-surface border border-border text-text-muted hover:border-accent/30"
                        }`}
                        title={opt.description}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="block text-xs text-text-muted mb-1">Your prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            placeholder="Additional instructions or refinements..."
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send Review"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
