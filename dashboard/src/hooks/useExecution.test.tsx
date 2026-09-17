import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import { useExecutions } from "./useExecution";
import type { ExecutionInfo } from "../lib/types";

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (payload: unknown) => void>() }));
vi.mock("./useSocket", () => ({ useSocketEvent: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler) }));
vi.mock("../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const info = {
  id: "exec-1", targetType: "project", targetName: "GED", runtime: "codex", status: "completed",
  pendingQuestion: { toolUseId: "q-1", questions: [{ question: "Qual acesso?", header: "Acesso", options: [], multiSelect: false }] },
} as ExecutionInfo;
const snapshot = [{ execId: info.id, info }];

beforeEach(() => {
  handlers.clear();
  vi.mocked(api.get).mockReset().mockImplementation(async (path) => {
    if (path === "/executions") return { active: [], recent: [info] };
    if (path === "/executions/pending-questions") return snapshot;
    return [];
  });
  vi.mocked(api.post).mockReset();
});

describe("perguntas pendentes", () => {
  it("recupera perguntas ao abrir a página e após reconectar", async () => {
    const { result, unmount } = renderHook(() => useExecutions());
    await waitFor(() => expect(result.current.pendingQuestions).toHaveLength(1));
    act(() => handlers.get("connect")?.(undefined));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(6));
    expect(result.current.pendingQuestions[0].question.toolUseId).toBe("q-1");
    unmount();
    const reopened = renderHook(() => useExecutions());
    await waitFor(() => expect(reopened.result.current.pendingQuestions).toHaveLength(1));
  });

  it("mantém a pergunta quando o envio falha", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useExecutions());
    await waitFor(() => expect(result.current.pendingQuestions).toHaveLength(1));
    await act(async () => {
      await expect(result.current.submitAnswer("exec-1", "Acesso restrito", "q-1")).rejects.toThrow("offline");
    });
    expect(result.current.pendingQuestions).toHaveLength(1);
  });

  it("uma resposta antiga não remove a próxima pergunta da mesma execução", async () => {
    let resolve!: (value: { id: string }) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useExecutions());
    await waitFor(() => expect(result.current.pendingQuestions).toHaveLength(1));
    let submitted!: Promise<string>;
    act(() => { submitted = result.current.submitAnswer("exec-1", "Restrito", "q-1"); });
    const next = { ...info, pendingQuestion: { ...info.pendingQuestion!, toolUseId: "q-2" } };
    act(() => handlers.get("execution:question")?.({ id: info.id, info: next }));
    act(() => handlers.get("execution:question:answered")?.({ id: info.id, toolUseId: "q-1" }));
    await act(async () => { resolve({ id: "exec-1" }); await submitted; });
    expect(api.post).toHaveBeenCalledWith("/executions/exec-1/answer", { answer: "Restrito", toolUseId: "q-1", answers: undefined });
    expect(result.current.pendingQuestions[0].question.toolUseId).toBe("q-2");
  });

  it("uma consulta iniciada antes da pergunta não apaga o evento recebido ao vivo", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === "/executions") return { active: [], recent: [] };
      if (path === "/executions/pending-questions") return new Promise((done) => { resolve = done; });
      return [];
    });
    const { result } = renderHook(() => useExecutions());
    await waitFor(() => expect(resolve).toBeDefined());
    act(() => handlers.get("execution:question")?.({ id: info.id, info }));
    const other = { ...info, id: "exec-2" };
    await act(async () => { resolve([{ execId: "exec-2", info: other }]); });
    expect(result.current.pendingQuestions.map((q) => q.execId).sort()).toEqual(["exec-1", "exec-2"]);
  });
});
