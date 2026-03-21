import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useExecutions } from "./useExecution";
import { useToast } from "../components/shared/Toast";
import { useCachedState } from "./useCachedState";
import type { ExecutionInfo, SessionData } from "../lib/types";

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
  const [dbHistory, setDbHistory] = useState<ExecutionInfo[]>([]);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [sessionFilter, setSessionFilter] = useState<string>("__all");
  const { active, recent, queue, pendingQuestions, submitAnswer } = useExecutions();
  const loadedTargetRef = useRef("");
  const lastLimitRef = useRef(0);
  const lastSessionFilterRef = useRef("__all");

  const sessionPath = `/executions/session/${targetType}/${targetName}`;

  const filteredActive = active.filter((e) => e.targetType === targetType && e.targetName === targetName);
  const filteredQueue = queue.filter((q) => q.targetType === targetType && q.targetName === targetName);
  const filteredQuestions = pendingQuestions.filter((pq) => pq.info.targetType === targetType && pq.info.targetName === targetName);

  const realtimeCompleted = recent.filter((e) => e.targetType === targetType && e.targetName === targetName);
  const dbIds = new Set(dbHistory.map((e) => e.id));
  const newFromRealtime = realtimeCompleted.filter((e) => {
    if (dbIds.has(e.id)) return false;
    if (sessionFilter !== "__all") {
      const sid = e.result?.sessionId ?? e.resumeSessionId;
      return sid === sessionFilter;
    }
    return true;
  });
  const filteredActiveBySession = sessionFilter === "__all"
    ? filteredActive
    : filteredActive.filter((e) => {
      const sid = e.result?.sessionId ?? e.resumeSessionId;
      return sid === sessionFilter;
    });
  const activity = [...filteredActiveBySession, ...newFromRealtime, ...dbHistory];

  const activeExec = execId ? active.find((e) => e.id === execId) : undefined;
  const isRunning = !!activeExec;

  const fetchHistory = useCallback((limit: number, filterSessionId?: string) => {
    const key = `${targetType}:${targetName}`;
    const sid = filterSessionId ?? lastSessionFilterRef.current;
    const params = new URLSearchParams({ limit: String(limit) });
    if (sid && sid !== "__all") params.set("sessionId", sid);
    api.get<Array<Record<string, unknown>>>(`/executions/history/${targetType}/${targetName}?${params}`).then((entries) => {
      const mapped: ExecutionInfo[] = entries.map((e: Record<string, unknown>) => ({
        id: e.id as string,
        source: (e.source as string) || "telegram",
        targetType: (e.targetType as string) || "orchestrator",
        targetName: (e.targetName as string) || "orchestrator",
        agentName: e.agentName as string | undefined,
        prompt: e.prompt as string,
        cwd: "",
        status: (e.status as string) || "completed",
        startedAt: e.startedAt as string,
        completedAt: e.completedAt as string | null,
        output: (e.output as string) ?? "",
        result: (e.costUsd || e.durationMs) ? {
          output: (e.output as string) ?? "",
          sessionId: (e.sessionId as string) ?? "",
          durationMs: e.durationMs as number,
          costUsd: e.costUsd as number,
          isError: e.status === "error",
          permissionDenials: [],
        } : null,
        error: (e.error as string) ?? null,
        pendingQuestion: null,
        planMode: e.planMode ?? false,
        username: e.username as string | undefined,
        resumeSessionId: e.sessionId as string | undefined,
      } as ExecutionInfo));
      setDbHistory(mapped);
      loadedTargetRef.current = key;
      lastLimitRef.current = limit;
    }).catch(() => {});
  }, [targetType, targetName]);

  useEffect(() => {
    const key = `${targetType}:${targetName}`;
    if (loadedTargetRef.current !== key) {
      setHistoryLimit(20);
      setSessionFilter("__all");
      lastSessionFilterRef.current = "__all";
      fetchHistory(20, "__all");
    }
  }, [targetType, targetName, fetchHistory]);

  useEffect(() => {
    const loaded = loadedTargetRef.current === `${targetType}:${targetName}`;
    if (loaded && (historyLimit !== lastLimitRef.current || sessionFilter !== lastSessionFilterRef.current)) {
      lastSessionFilterRef.current = sessionFilter;
      fetchHistory(historyLimit, sessionFilter);
    }
  }, [historyLimit, sessionFilter, targetType, targetName, fetchHistory]);

  const loadSession = useCallback(() => {
    api.get<SessionData>(sessionPath).then(setSessionData).catch(() => {});
  }, [sessionPath]);

  useEffect(() => {
    const running = active.find((e) => e.targetType === targetType && e.targetName === targetName);
    if (running) {
      setExecId(running.id);
    } else if (execId && !active.some((e) => e.id === execId)) {
      loadSession();
      fetchHistory(historyLimit);
      onExecutionComplete?.();
    }
  }, [active, execId, targetType, targetName, loadSession, fetchHistory, historyLimit, onExecutionComplete]);

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

  const handleSessionDelete = async (sessionId: string) => {
    try {
      await api.delete(`/executions/session-entry/${sessionId}`);
      const isActive = sessionData.sessionId === sessionId;
      setSessionData((prev) => ({
        ...prev,
        sessionId: isActive ? null : prev.sessionId,
        history: prev.history.filter((s) => s !== sessionId),
      }));
      if (isActive) {
        await api.delete(sessionPath);
      }
      addToast("success", "Session removed");
    } catch {
      addToast("error", "Failed to remove session");
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
    handleSessionDelete,
    activity,
    historyLimit,
    setHistoryLimit,
    sessionFilter,
    setSessionFilter,
    filteredQueue,
    filteredQuestions,
    submitAnswer,
    toggleExpanded,
    addToast,
  };
}
