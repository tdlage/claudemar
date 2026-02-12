import { useState, useCallback, useEffect } from "react";
import { api } from "../lib/api";
import { useSocketEvent } from "./useSocket";
import { seedOutput, clearOutput } from "../lib/outputBuffer";
import type { ExecutionInfo, QueueItem } from "../lib/types";

const MAX_RECENT = 200;

function isInternalExec(info: ExecutionInfo): boolean {
  return info.targetName.startsWith("__");
}

export function useExecutions() {
  const [active, setActive] = useState<ExecutionInfo[]>([]);
  const [recent, setRecent] = useState<ExecutionInfo[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);

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

  useSocketEvent<{ item: QueueItem }>("queue:add", ({ item }) => {
    setQueue((prev) => [...prev, item]);
  });

  useSocketEvent<{ item: QueueItem }>("queue:remove", ({ item }) => {
    setQueue((prev) => prev.filter((q) => q.id !== item.id));
  });

  return { active, recent, queue, refresh };
}
