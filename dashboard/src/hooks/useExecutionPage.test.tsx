import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useExecutionPage } from "./useExecutionPage";
import { api } from "../lib/api";
import type { ExecutionInfo } from "../lib/types";

vi.mock("../lib/api", () => ({
  api: { get: vi.fn() },
}));

const executionsState: { active: ExecutionInfo[] } = { active: [] };

vi.mock("./useExecution", () => ({
  useExecutions: () => ({
    active: [...executionsState.active],
    recent: [],
    queue: [],
    pendingQuestions: [],
    usageById: {},
    submitAnswer: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const getMock = vi.mocked(api.get);

function makeExec(id: string): ExecutionInfo {
  return {
    id,
    source: "web",
    targetType: "agent",
    targetName: "Jarvis",
    prompt: "test",
    cwd: "",
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    output: "",
    result: null,
    error: null,
    pendingQuestion: null,
    planMode: false,
  } as unknown as ExecutionInfo;
}

function sessionCalls() {
  return getMock.mock.calls.filter(([p]) => (p as string).startsWith("/executions/session/")).length;
}

function historyCalls() {
  return getMock.mock.calls.filter(([p]) => (p as string).startsWith("/executions/history/")).length;
}

describe("useExecutionPage — rotina de conclusão", () => {
  beforeEach(() => {
    executionsState.active = [];
    getMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/executions/session/")) {
        return Promise.resolve({ sessionId: null, history: [], names: {}, models: {} });
      }
      return Promise.resolve([]);
    });
  });

  it("dispara uma única vez por execução, mesmo com re-renders e callback instável", async () => {
    let completeCalls = 0;
    executionsState.active = [makeExec("exec-1")];

    const { rerender } = renderHook(
      ({ onComplete }: { onComplete: () => void }) =>
        useExecutionPage({
          targetType: "agent",
          targetName: "Jarvis",
          cachePrefix: `agent:Jarvis:${Date.now()}:loop`,
          onExecutionComplete: onComplete,
        }),
      { initialProps: { onComplete: () => { completeCalls++; } } },
    );

    rerender({ onComplete: () => { completeCalls++; } });
    expect(completeCalls).toBe(0);

    executionsState.active = [];
    for (let i = 0; i < 5; i++) {
      rerender({ onComplete: () => { completeCalls++; } });
    }

    await waitFor(() => expect(completeCalls).toBe(1));
    expect(sessionCalls()).toBe(1);
    expect(historyCalls()).toBe(2);

    for (let i = 0; i < 5; i++) {
      rerender({ onComplete: () => { completeCalls++; } });
    }
    await waitFor(() => expect(completeCalls).toBe(1));
    expect(sessionCalls()).toBe(1);
    expect(historyCalls()).toBe(2);
  });

  it("dispara de novo quando uma nova execução termina", async () => {
    let completeCalls = 0;
    const onComplete = () => { completeCalls++; };
    executionsState.active = [makeExec("exec-1")];

    const { rerender } = renderHook(
      ({ onCompleteProp }: { onCompleteProp: () => void }) =>
        useExecutionPage({
          targetType: "agent",
          targetName: "Jarvis",
          cachePrefix: `agent:Jarvis:${Date.now()}:again`,
          onExecutionComplete: onCompleteProp,
        }),
      { initialProps: { onCompleteProp: onComplete } },
    );

    executionsState.active = [];
    rerender({ onCompleteProp: onComplete });
    await waitFor(() => expect(completeCalls).toBe(1));

    executionsState.active = [makeExec("exec-2")];
    rerender({ onCompleteProp: onComplete });

    executionsState.active = [];
    rerender({ onCompleteProp: onComplete });
    await waitFor(() => expect(completeCalls).toBe(2));

    rerender({ onCompleteProp: onComplete });
    await waitFor(() => expect(completeCalls).toBe(2));
  });
});
