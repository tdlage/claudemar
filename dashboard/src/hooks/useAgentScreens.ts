import { useState, useCallback } from "react";
import { useSocketEvent } from "./useSocket";

export interface ScreenState {
  execId: string;
  running: boolean;
  blink: boolean;
}

interface FinishedRun { execId: string; seen: boolean }
interface ExecLike { id: string; targetType: string; targetName: string }
interface EndPayload { id: string; info?: { targetType: string; targetName: string } }

export function useAgentScreens(active: ExecLike[]): {
  screenFor: (name: string) => ScreenState | null;
  markSeen: (name: string) => void;
} {
  const [finished, setFinished] = useState<Record<string, FinishedRun>>({});

  const onDone = useCallback((d: EndPayload) => {
    if (d.info?.targetType !== "agent") return;
    const name = d.info.targetName;
    setFinished((prev) => ({ ...prev, [name]: { execId: d.id, seen: false } }));
  }, []);
  useSocketEvent<EndPayload>("execution:complete", onDone);
  useSocketEvent<EndPayload>("execution:error", onDone);
  useSocketEvent<EndPayload>("execution:cancel", onDone);

  useSocketEvent<EndPayload>("execution:start", (d) => {
    if (d.info?.targetType !== "agent") return;
    const name = d.info.targetName;
    setFinished((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  });

  const markSeen = useCallback((name: string) => {
    setFinished((prev) => (prev[name] && !prev[name].seen ? { ...prev, [name]: { ...prev[name], seen: true } } : prev));
  }, []);

  const activeByName = new Map<string, string>();
  for (const e of active) if (e.targetType === "agent") activeByName.set(e.targetName, e.id);

  const screenFor = (name: string): ScreenState | null => {
    const runId = activeByName.get(name);
    if (runId) return { execId: runId, running: true, blink: false };
    const f = finished[name];
    if (f) return { execId: f.execId, running: false, blink: !f.seen };
    return null;
  };

  return { screenFor, markSeen };
}
