import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useExecutions } from "./useExecution";
import { useToast } from "../components/shared/Toast";
import { useCachedState } from "./useCachedState";
import type { SessionData } from "../lib/types";

interface UseExecutionPageOptions {
  targetType: string;
  targetName: string;
  cachePrefix: string;
  onExecutionComplete?: () => void;
}

export function useExecutionPage({ targetType, targetName, cachePrefix, onExecutionComplete }: UseExecutionPageOptions) {
  const { addToast } = useToast();
  const [execId, setExecId] = useCachedState<string | null>(`${cachePrefix}:execId`, null);
  const [expandedExecId, setExpandedExecId] = useCachedState<string | null>(`${cachePrefix}:expandedExecId`, null);
  const [sessionData, setSessionData] = useState<SessionData>({ sessionId: null, history: [], names: {} });
  const { active, recent, queue, pendingQuestions, submitAnswer } = useExecutions();

  const sessionPath = `/executions/session/${targetType}/${targetName}`;

  const filteredActive = active.filter((e) => e.targetType === targetType && e.targetName === targetName);
  const filteredRecent = recent.filter((e) => e.targetType === targetType && e.targetName === targetName);
  const activity = [...filteredActive, ...filteredRecent];
  const filteredQueue = queue.filter((q) => q.targetType === targetType && q.targetName === targetName);
  const filteredQuestions = pendingQuestions.filter((pq) => pq.info.targetType === targetType && pq.info.targetName === targetName);

  const activeExec = execId ? active.find((e) => e.id === execId) : undefined;
  const isRunning = !!activeExec;

  const loadSession = useCallback(() => {
    api.get<SessionData>(sessionPath).then(setSessionData).catch(() => {});
  }, [sessionPath]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === targetType && e.targetName === targetName);
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      loadSession();
      onExecutionComplete?.();
    }
  }, [active, execId, targetType, targetName, loadSession, onExecutionComplete]);

  const handleSessionChange = async (value: string) => {
    if (value === "__new") {
      try {
        await api.delete(sessionPath);
        setSessionData((prev) => ({ ...prev, sessionId: null }));
        addToast("success", "New session");
      } catch {
        addToast("error", "Failed to reset session");
      }
    } else {
      try {
        await api.put(sessionPath, { sessionId: value });
        setSessionData((prev) => ({ ...prev, sessionId: value }));
        addToast("success", `Session: ${sessionData.names[value] ?? value.slice(0, 8)}`);
      } catch {
        addToast("error", "Failed to switch session");
      }
    }
  };

  const handleSessionRename = async (sessionId: string, newName: string) => {
    try {
      await api.patch(`${sessionPath}/rename`, { sessionId, name: newName });
      setSessionData((prev) => ({ ...prev, names: { ...prev.names, [sessionId]: newName } }));
      addToast("success", "Session renamed");
    } catch {
      addToast("error", "Failed to rename session");
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedExecId((prev) => (prev === id ? null : id));
  };

  return {
    execId,
    setExecId,
    expandedExecId,
    activeExec,
    isRunning,
    sessionData,
    loadSession,
    handleSessionChange,
    handleSessionRename,
    activity,
    filteredQueue,
    filteredQuestions,
    submitAnswer,
    toggleExpanded,
    addToast,
  };
}
