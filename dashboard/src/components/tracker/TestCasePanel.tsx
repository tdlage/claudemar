import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "../shared/Badge";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { useTestCases } from "../../hooks/useTracker";
import { CreateTestCaseModal } from "./CreateTestCaseModal";
import { TestRunPanel } from "./TestRunPanel";
import { PRIORITY_VARIANT, TEST_RUN_STATUS_CONFIG } from "./constants";
import type { TrackerTestCase } from "../../lib/types";

interface Props {
  targetType: "bet";
  targetId: string;
}

function TestCaseCard({ tc, onDelete }: { tc: TrackerTestCase; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lastRun = tc.lastRunStatus ? TEST_RUN_STATUS_CONFIG[tc.lastRunStatus] : null;
  const passRate = tc.totalRuns ? Math.round(((tc.passCount ?? 0) / tc.totalRuns) * 100) : 0;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-surface-hover transition-colors group"
      >
        {expanded ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}

        <span className="text-sm font-medium text-text-primary flex-1 truncate">{tc.title}</span>

        <div className="flex items-center gap-2 shrink-0">
          {lastRun ? (
            <span className={`text-sm font-bold ${lastRun.color}`}>{lastRun.icon}</span>
          ) : (
            <span className="text-xs text-text-muted">—</span>
          )}

          {(tc.totalRuns ?? 0) > 0 && (
            <span className="text-xs text-text-muted">
              {tc.passCount ?? 0}/{tc.totalRuns}
            </span>
          )}

          {(tc.totalRuns ?? 0) > 0 && (
            <div className="w-12 h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{ width: `${passRate}%` }}
              />
            </div>
          )}

          <Badge variant={PRIORITY_VARIANT[tc.priority]}>{tc.priority}</Badge>

          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3 bg-bg/50">
          {tc.preconditions && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Preconditions</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{tc.preconditions}</p>
            </div>
          )}
          {tc.steps && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Steps</p>
              <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono text-xs">{tc.steps}</pre>
            </div>
          )}
          {tc.expectedResult && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Expected Result</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{tc.expectedResult}</p>
            </div>
          )}
          {tc.description && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">Description</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{tc.description}</p>
            </div>
          )}

          <div className="border-t border-border pt-3">
            <TestRunPanel testCaseId={tc.id} />
          </div>
        </div>
      )}
    </div>
  );
}

export function TestCasePanel({ targetType, targetId }: Props) {
  const { addToast } = useToast();
  const { testCases } = useTestCases(targetType, targetId);
  const [createOpen, setCreateOpen] = useState(false);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this test case and all its runs?")) return;
    try {
      await api.delete(`/tracker/test-cases/${id}`);
    } catch {
      addToast("error", "Failed to delete test case");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Test Cases</p>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={14} /> New Test Case
        </button>
      </div>

      {testCases.length === 0 && <p className="text-sm text-text-muted">No test cases yet.</p>}

      <div className="space-y-2">
        {testCases.map((tc) => (
          <TestCaseCard key={tc.id} tc={tc} onDelete={() => handleDelete(tc.id)} />
        ))}
      </div>

      <CreateTestCaseModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        targetType={targetType}
        targetId={targetId}
      />
    </div>
  );
}
