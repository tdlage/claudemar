import { useState, useCallback, useEffect } from "react";
import { api } from "../lib/api";
import { useSocketEvent } from "./useSocket";
import type { ExecutionInfo } from "../lib/types";

const MAX_RECENT = 200;

export function useExecutions() {
  const [active, setActive] = useState<ExecutionInfo[]>([]);
  const [recent, setRecent] = useState<ExecutionInfo[]>([]);

  const refresh = useCallback(async () => {
    const data = await api.get<{ active: ExecutionInfo[]; recent: ExecutionInfo[] }>(
      "/executions",
    );
    setActive(data.active);
    setRecent(data.recent);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:start", ({ info }) => {
    setActive((prev) => [...prev, info]);
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:complete", ({ id, info }) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => [...prev, info].slice(-MAX_RECENT));
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:error", ({ id, info }) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => [...prev, info].slice(-MAX_RECENT));
  });

  useSocketEvent<{ id: string; info: ExecutionInfo }>("execution:cancel", ({ id, info }) => {
    setActive((prev) => prev.filter((e) => e.id !== id));
    setRecent((prev) => [...prev, info].slice(-MAX_RECENT));
  });

  return { active, recent, refresh };
}
