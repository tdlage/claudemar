import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useSocketEvent } from "./useSocket";
import { seedOutput, clearOutput } from "../lib/outputBuffer";
import type { ExecutionInfo, ExecutionUsage, PendingQuestion, QueueItem } from "../lib/types";

const MAX_RECENT = 200;

function isInternalExec(info: ExecutionInfo): boolean {
  return info.targetName.startsWith("__");
}

export interface PendingQuestionEntry {
  execId: string;
  question: PendingQuestion;
  info: ExecutionInfo;
}

export function useExecutions() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ExecutionInfo[]>([]);
  const [recent, setRecent] = useState<ExecutionInfo[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionEntry[]>([]);
  const [usageById, setUsageById] = useState<Record<string, ExecutionUsage>>({});
  const questionRevision = useRef(0);
  const questionChanges = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    try {
    const revision = questionRevision.current;
    const data = await api.get<{ active: ExecutionInfo[]; recent: ExecutionInfo[] }>(
      "/executions",
    );
    setActive(data.active.filter((e) => !isInternalExec(e)));
    setRecent(data.recent.filter((e) => !isInternalExec(e)));
    for (const exec of [...data.active, ...data.recent]) {
      if (exec.output) seedOutput(exec.id, exec.output);
    }

    const queueData = await api.get<QueueItem[]>("/executions/queue");
    setQueue(queueData);

    const pqData = await api.get<Array<{ execId: string; info: ExecutionInfo }>>(
      "/executions/pending-questions",
    );
    setPendingQuestions((prev) => [
      ...pqData
        .filter((pq) => pq.info.pendingQuestion && !isInternalExec(pq.info) && (questionChanges.current.get(pq.execId) ?? 0) <= revision)
        .map((pq) => ({
          execId: pq.execId,
          question: pq.info.pendingQuestion!,
          info: pq.info,
        })),
      ...prev.filter((pq) => (questionChanges.current.get(pq.execId) ?? 0) > revision),
    ]);
    setError(null);
    } catch {
      setError("Não foi possível atualizar as execuções. Os dados podem estar desatualizados.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useSocketEvent("connect", () => {
    void refresh();
  });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [active.length, refresh]);

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:start", ({ info }) => {
    if (isInternalExec(info)) return;
    setActive((prev) => [...prev, info]);
  });

  const moveToRecent = useCallback((id: string, info: ExecutionInfo) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => {
      const updated = [...prev.filter((e) => e.id !== id), info];
      const dropped = updated.slice(0, Math.max(0, updated.length - MAX_RECENT));
      for (const d of dropped) clearOutput(d.id);
      return updated.slice(-MAX_RECENT);
    });
  }, []);

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:complete", ({ id, info }) => moveToRecent(id, info));
  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:error", ({ id, info }) => moveToRecent(id, info));
  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:cancel", ({ id, info }) => moveToRecent(id, info));

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:question", ({ id, info }) => {
    if (!info.pendingQuestion || isInternalExec(info)) return;
    questionChanges.current.set(id, ++questionRevision.current);
    setPendingQuestions((prev) => [
      ...prev.filter((pq) => pq.execId !== id),
      { execId: id, question: info.pendingQuestion!, info },
    ]);
  });

  useSocketEvent<{ id: string; info: ExecutionInfo; toolUseId?: string }>("execution:question:answered", ({ id, toolUseId }) => {
    questionChanges.current.set(id, ++questionRevision.current);
    setPendingQuestions((prev) => prev.filter((pq) => pq.execId !== id || (toolUseId && pq.question.toolUseId !== toolUseId)));
  });

  useSocketEvent<{ id: string; costUsd: number; tokens: number; contextPct: number }>(
    "execution:usage",
    ({ id, costUsd, tokens, contextPct }) => {
      setUsageById((prev) => ({ ...prev, [id]: { costUsd, tokens, contextPct } }));
    },
  );

  useSocketEvent<{ item: QueueItem }>("queue:add", ({ item }) => {
    setQueue((prev) => [...prev, item]);
  });

  useSocketEvent<{ item: QueueItem }>("queue:remove", ({ item }) => {
    setQueue((prev) => prev.filter((q) => q.id !== item.id));
  });

  const submitAnswer = useCallback(async (execId: string, answer: string, toolUseId?: string, answers?: Record<string, string>) => {
    const result = await api.post<{ id: string }>(`/executions/${execId}/answer`, { answer, toolUseId, answers });
    questionChanges.current.set(execId, ++questionRevision.current);
    setPendingQuestions((prev) => prev.filter((pq) => pq.execId !== execId || (toolUseId && pq.question.toolUseId !== toolUseId)));
    return result.id;
  }, []);

  return { active, recent, queue, pendingQuestions, usageById, submitAnswer, refresh, loading, error };
}
