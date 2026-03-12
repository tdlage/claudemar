import { useState } from "react";
import { Play, MessageSquare, Loader2, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { ReviewPlanModal } from "./ReviewPlanModal";
import type { TrackerItemPlan } from "../../lib/types";

interface Props {
  plan: TrackerItemPlan;
  itemId: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon?: React.ReactNode }> = {
  planning: { label: "Planning", color: "bg-blue-500/10 text-blue-400", icon: <Loader2 size={12} className="animate-spin" /> },
  planned: { label: "Plan Ready", color: "bg-accent/10 text-accent" },
  executing: { label: "Executing", color: "bg-warning/10 text-warning", icon: <Loader2 size={12} className="animate-spin" /> },
  reviewing: { label: "Reviewing", color: "bg-blue-500/10 text-blue-400", icon: <Loader2 size={12} className="animate-spin" /> },
  completed: { label: "Completed", color: "bg-success/10 text-success", icon: <CheckCircle size={12} /> },
  error: { label: "Error", color: "bg-danger/10 text-danger", icon: <AlertCircle size={12} /> },
};

export function ItemPlanSection({ plan, itemId }: Props) {
  const { addToast } = useToast();
  const [executing, setExecuting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const status = STATUS_CONFIG[plan.status] ?? STATUS_CONFIG.error;

  const handleExecute = async () => {
    if (executing) return;
    setExecuting(true);
    try {
      await api.post(`/tracker/items/${itemId}/execute-plan`);
      addToast("success", "Plan execution started");
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to execute plan");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
            {status.icon}
            {status.label}
          </span>
          <span className="text-xs text-text-muted">
            Project: <span className="text-text-primary">{plan.targetProject}</span>
          </span>
          {plan.lastExecutionId && (
            <a
              href={`/projects/${plan.targetProject}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <ExternalLink size={10} />
              View Session
            </a>
          )}
        </div>

        {plan.status === "planned" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReviewOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text-primary hover:bg-surface-hover transition-colors"
            >
              <MessageSquare size={12} />
              Review Plan
            </button>
            <button
              onClick={handleExecute}
              disabled={executing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-success/20 text-success hover:bg-success/30 transition-colors disabled:opacity-50"
            >
              <Play size={12} />
              {executing ? "Starting..." : "Execute Plan"}
            </button>
          </div>
        )}
      </div>

      {plan.pendingQuestions && plan.pendingQuestions.length > 0 && plan.status === "planned" && (
        <div className="border border-warning/30 rounded-md p-3 bg-warning/5">
          <div className="text-xs font-medium text-warning mb-2">Pending Questions from Claude</div>
          {plan.pendingQuestions.map((q, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="text-sm text-text-primary mb-1">{q.question}</div>
              <div className="flex flex-wrap gap-1">
                {q.options.map((opt, j) => (
                  <span key={j} className="px-2 py-0.5 rounded text-xs bg-surface border border-border text-text-muted">
                    {opt.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {plan.planMarkdown && (
        <div className="border border-border rounded-md bg-bg">
          <div className="px-3 py-1.5 border-b border-border text-xs text-text-muted font-medium">
            Plan Output
          </div>
          <pre className="px-4 py-3 text-sm text-text-primary whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto font-mono leading-relaxed">
            {plan.planMarkdown}
          </pre>
        </div>
      )}

      {plan.promptSent && (
        <details className="text-xs">
          <summary className="text-text-muted cursor-pointer hover:text-text-primary">Original Prompt</summary>
          <pre className="mt-2 px-3 py-2 bg-bg border border-border rounded-md text-text-muted whitespace-pre-wrap font-mono">
            {plan.promptSent}
          </pre>
        </details>
      )}

      <ReviewPlanModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        itemId={itemId}
        pendingQuestions={plan.pendingQuestions}
      />
    </div>
  );
}
