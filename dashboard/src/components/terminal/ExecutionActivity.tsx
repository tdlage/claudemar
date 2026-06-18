import { ActivityFeed } from "../overview/ActivityFeed";
import type { ExecutionInfo, QueueItem, SessionData } from "../../lib/types";

interface ExecutionActivityProps {
  activity: ExecutionInfo[];
  filteredQueue: QueueItem[];
  expandedExecId: string | null;
  toggleExpanded: (id: string) => void;
  sessionData: SessionData;
  sessionFilter: string;
  setSessionFilter: (filter: string) => void;
  historyLimit: number;
  setHistoryLimit: (limit: number) => void;
  searchQuery: string;
  handleSearchChange: (query: string) => void;
}

export function ExecutionActivity({
  activity,
  filteredQueue,
  expandedExecId,
  toggleExpanded,
  sessionData,
  sessionFilter,
  setSessionFilter,
  historyLimit,
  setHistoryLimit,
  searchQuery,
  handleSearchChange,
}: ExecutionActivityProps) {
  if (activity.length === 0 && filteredQueue.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-medium text-text-muted mb-2">Activity</h2>
      <ActivityFeed
        executions={activity}
        queue={filteredQueue}
        expandedId={expandedExecId}
        onToggle={toggleExpanded}
        sessionNames={sessionData.names}
        sessionIds={sessionData.history}
        sessionFilter={sessionFilter}
        onSessionFilterChange={setSessionFilter}
        historyLimit={historyLimit}
        onHistoryLimitChange={setHistoryLimit}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
      />
    </div>
  );
}
