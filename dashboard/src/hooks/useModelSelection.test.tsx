import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useModelSelection } from "./useModelSelection";

vi.mock("../lib/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));

it("loads the Activity default but preserves a manual choice until the next execution or reopening", async () => {
  const models = [
    { model: "codex::gpt-5.6-sol", modelId: "gpt-5.6-sol", runtime: "codex", providerId: "codex" },
    { model: "anthropic::claude-opus-5", modelId: "claude-opus-5", runtime: "claude", providerId: "anthropic" },
  ];
  vi.mocked(api.get).mockImplementation(async (path) => path === "/system/provider"
    ? { selectableModels: models, defaultModel: models[1].model }
    : { model: models[0].model });
  vi.mocked(api.put).mockResolvedValue({ model: models[1].model });
  const { result, rerender, unmount } = renderHook(({ executionId }) => useModelSelection("project:app", executionId), { initialProps: { executionId: "old" } });
  await waitFor(() => expect(result.current.model).toBe(models[0].model));
  await act(async () => { await result.current.select(models[1].model); });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(result.current.model).toBe(models[1].model);
  rerender({ executionId: "new" });
  await waitFor(() => expect(result.current.model).toBe(models[0].model));
  unmount();
  const reopened = renderHook(() => useModelSelection("project:app"));
  await waitFor(() => expect(reopened.result.current.model).toBe(models[0].model));
});
