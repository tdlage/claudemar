import { useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import type { ExecutionInfo } from "../lib/types";

type ExecutionEvent = { id: string; info: ExecutionInfo; toolUseId?: string };

const execTargets = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();
let detach: (() => void) | null = null;

function targetKey(info: ExecutionInfo): string {
  return `${info.targetType}:${info.targetName}`;
}

function publish(): void {
  snapshot = new Set(execTargets.values());
  for (const listener of listeners) listener();
}

function track(id: string, info: ExecutionInfo): void {
  if (!info.pendingQuestion || info.targetName.startsWith("__")) return;
  execTargets.set(id, targetKey(info));
  publish();
}

function untrack(id: string): void {
  if (execTargets.delete(id)) publish();
}

async function reload(): Promise<void> {
  try {
    const pending = await api.get<Array<{ execId: string; info: ExecutionInfo }>>("/executions/pending-questions");
    execTargets.clear();
    for (const { execId, info } of pending) {
      if (info.pendingQuestion && !info.targetName.startsWith("__")) execTargets.set(execId, targetKey(info));
    }
    publish();
  } catch {
    /* Mantém o último estado conhecido até a próxima reconexão. */
  }
}

function attach(): () => void {
  const socket = getSocket();
  const onQuestion = ({ id, info }: ExecutionEvent) => track(id, info);
  const onAnswered = ({ id, info }: ExecutionEvent) => (info.pendingQuestion ? track(id, info) : untrack(id));
  const onFinished = ({ id, info }: ExecutionEvent) => (info.pendingQuestion ? track(id, info) : untrack(id));
  const onConnect = () => void reload();
  socket.on("execution:question", onQuestion);
  socket.on("execution:question:answered", onAnswered);
  socket.on("execution:complete", onFinished);
  socket.on("execution:error", onFinished);
  socket.on("execution:cancel", onFinished);
  socket.on("connect", onConnect);
  void reload();
  return () => {
    socket.off("execution:question", onQuestion);
    socket.off("execution:question:answered", onAnswered);
    socket.off("execution:complete", onFinished);
    socket.off("execution:error", onFinished);
    socket.off("execution:cancel", onFinished);
    socket.off("connect", onConnect);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!detach) detach = attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detach) {
      detach();
      detach = null;
    }
  };
}

export function usePendingQuestionTargets(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot);
}
