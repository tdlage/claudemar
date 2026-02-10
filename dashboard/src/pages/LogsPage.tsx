import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { Search, Filter } from "lucide-react";
import { useExecutions } from "../hooks/useExecution";
import { useDebounce } from "../hooks/useDebounce";
import { Badge } from "../components/shared/Badge";
import { Card } from "../components/shared/Card";
import type { ExecutionInfo, ExecutionStatus, ExecutionTargetType } from "../lib/types";

const STATUS_OPTIONS: ExecutionStatus[] = ["running", "completed", "error", "cancelled"];
const TARGET_OPTIONS: ExecutionTargetType[] = ["orchestrator", "project", "agent"];
const PAGE_SIZE = 25;

export function LogsPage() {
  const { active, recent } = useExecutions();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<ExecutionStatus | "all">("all");
  const [targetFilter, setTargetFilter] = useState<ExecutionTargetType | "all">("all");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const all = useMemo(() => {
    return [...active, ...recent].sort((a, b) => {
      const dateA = a.completedAt ?? a.startedAt;
      const dateB = b.completedAt ?? b.startedAt;
      return dateB.localeCompare(dateA);
    });
  }, [active, recent]);

  const filtered = useMemo(() => {
    return all.filter((exec) => {
      if (statusFilter !== "all" && exec.status !== statusFilter) return false;
      if (targetFilter !== "all" && exec.targetType !== targetFilter) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const matchPrompt = exec.prompt.toLowerCase().includes(q);
        const matchTarget = exec.targetName.toLowerCase().includes(q);
        if (!matchPrompt && !matchTarget) return false;
      }
      return true;
    });
  }, [all, statusFilter, targetFilter, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const statusVariant = (status: ExecutionStatus) => {
    switch (status) {
      case "completed": return "success" as const;
      case "error": return "danger" as const;
      case "cancelled": return "warning" as const;
      default: return "default" as const;
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Execution Logs</h1>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search prompts, targets..."
            className="w-full bg-surface border border-border rounded-md pl-9 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter size={14} className="text-text-muted" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as ExecutionStatus | "all"); setPage(0); }}
            className="bg-surface border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={targetFilter}
            onChange={(e) => { setTargetFilter(e.target.value as ExecutionTargetType | "all"); setPage(0); }}
            className="bg-surface border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="all">All targets</option>
            {TARGET_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-text-muted">
        {filtered.length} execution{filtered.length !== 1 ? "s" : ""}
        {statusFilter !== "all" || targetFilter !== "all" || debouncedSearch ? " (filtered)" : ""}
      </p>

      <div className="space-y-1">
        {paginated.length === 0 ? (
          <p className="text-sm text-text-muted py-8 text-center">No executions match your filters.</p>
        ) : (
          paginated.map((exec) => (
            <LogEntry
              key={exec.id}
              exec={exec}
              statusVariant={statusVariant(exec.status)}
              expanded={expandedId === exec.id}
              onToggle={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
            />
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-sm bg-surface border border-border rounded disabled:opacity-30 hover:bg-surface-hover text-text-primary"
          >
            Previous
          </button>
          <span className="text-xs text-text-muted">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-sm bg-surface border border-border rounded disabled:opacity-30 hover:bg-surface-hover text-text-primary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function LogEntry({
  exec,
  statusVariant,
  expanded,
  onToggle,
}: {
  exec: ExecutionInfo;
  statusVariant: "success" | "danger" | "warning" | "default";
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-surface-hover transition-colors"
      >
        <Badge variant={statusVariant}>{exec.status}</Badge>
        <span className="text-xs text-accent font-medium min-w-[60px]">{exec.targetType}</span>
        <span className="text-xs text-text-muted min-w-[80px]">{exec.targetName}</span>
        <span className="text-text-primary truncate flex-1">{exec.prompt}</span>
        {exec.result && (
          <span className="text-xs text-text-muted whitespace-nowrap">
            {(exec.result.durationMs / 1000).toFixed(1)}s · ${exec.result.costUsd.toFixed(2)}
          </span>
        )}
        <span className="text-xs text-text-muted min-w-[70px] text-right whitespace-nowrap">
          {exec.completedAt
            ? formatDistanceToNow(new Date(exec.completedAt), { addSuffix: true })
            : "running"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border bg-bg px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-text-muted">ID: </span>
              <span className="text-text-secondary font-mono">{exec.id}</span>
            </div>
            <div>
              <span className="text-text-muted">Source: </span>
              <span className="text-text-secondary">{exec.source}</span>
            </div>
            <div>
              <span className="text-text-muted">Started: </span>
              <span className="text-text-secondary">{new Date(exec.startedAt).toLocaleString()}</span>
            </div>
            {exec.completedAt && (
              <div>
                <span className="text-text-muted">Completed: </span>
                <span className="text-text-secondary">{new Date(exec.completedAt).toLocaleString()}</span>
              </div>
            )}
            <div className="col-span-2">
              <span className="text-text-muted">CWD: </span>
              <span className="text-text-secondary font-mono">{exec.cwd}</span>
            </div>
          </div>
          {exec.error && (
            <div className="text-xs">
              <span className="text-danger font-medium">Error: </span>
              <span className="text-danger/80">{exec.error}</span>
            </div>
          )}
          {exec.output && (
            <div>
              <p className="text-xs text-text-muted mb-1">Output (truncated):</p>
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap overflow-auto max-h-48 bg-surface rounded p-2 border border-border">
                {exec.output.slice(0, 2000)}
                {exec.output.length > 2000 ? "\n...(truncated)" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
