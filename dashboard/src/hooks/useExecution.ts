import { useState, useCallback, useEffect } from "react";
import { api } from "../lib/api";
import { useSocketEvent } from "./useSocket";
import { seedOutput, clearOutput } from "../lib/outputBuffer";
import type { ExecutionInfo, PendingQuestion, QueueItem } from "../lib/types";

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
  const [active, setActive] = useState<ExecutionInfo[]>([]);
  const [recent, setRecent] = useState<ExecutionInfo[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionEntry[]>([]);

  const refresh = useCallback(async () => {
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
    setPendingQuestions(
      pqData
        .filter((pq) => pq.info.pendingQuestion)
        .map((pq) => ({
          execId: pq.execId,
          question: pq.info.pendingQuestion!,
          info: pq.info,
        })),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:start", ({ info }) => {
    if (isInternalExec(info)) return;
    setActive((prev) => [...prev, info]);
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:complete", ({ id, info }) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => {
      const updated = [...prev.filter((e) => e.id !== id), info];
      const dropped = updated.slice(0, Math.max(0, updated.length - MAX_RECENT));
      for (const d of dropped) clearOutput(d.id);
      return updated.slice(-MAX_RECENT);
    });
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:error", ({ id, info }) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => {
      const updated = [...prev.filter((e) => e.id !== id), info];
      const dropped = updated.slice(0, Math.max(0, updated.length - MAX_RECENT));
      for (const d of dropped) clearOutput(d.id);
      return updated.slice(-MAX_RECENT);
    });
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:cancel", ({ id, info }) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => {
      const updated = [...prev.filter((e) => e.id !== id), info];
      const dropped = updated.slice(0, Math.max(0, updated.length - MAX_RECENT));
      for (const d of dropped) clearOutput(d.id);
      return updated.slice(-MAX_RECENT);
    });
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:question", ({ id, info }) => {
    if (!info.pendingQuestion) return;
    setPendingQuestions((prev) => [
      ...prev.filter((pq) => pq.execId !== id),
      { execId: id, question: info.pendingQuestion!, info },
    ]);
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:question:answered", ({ id }) => {
    setPendingQuestions((prev) => prev.filter((pq) => pq.execId !== id));
  });

  useSocketEvent<{ item: QueueItem }>("queue:add", ({ item }) => {
    setQueue((prev) => [...prev, item]);
  });

  useSocketEvent<{ item: QueueItem }>("queue:remove", ({ item }) => {
    setQueue((prev) => prev.filter((q) => q.id !== item.id));
  });

  const submitAnswer = useCallback(async (execId: string, answer: string) => {
    const result = await api.post<{ id: string }>(`/executions/${execId}/answer`, { answer });
    setPendingQuestions((prev) => prev.filter((pq) => pq.execId !== execId));
    return result.id;
  }, []);

  return { active, recent, queue, pendingQuestions, submitAnswer, refresh };
}
