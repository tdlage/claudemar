import { api } from "../../lib/api";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "./Terminal";
import { getSlashCache, setSlashCache } from "../../lib/slashCache";

const { handlers, socket } = vi.hoisted(() => {
  const handlers = new Map<string, (data: unknown) => void>();
  return { handlers, socket: {
    on: vi.fn((event: string, handler: (data: unknown) => void) => handlers.set(event, handler)),
    off: vi.fn((event: string) => handlers.delete(event)),
    emit: vi.fn(),
  } };
});
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock("../../lib/socket", () => ({ getSocket: () => socket }));
vi.mock("../../hooks/useCurrentModel", () => ({ useCurrentModel: () => ({ runtime: "claude", displayName: "Claude" }) }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

beforeEach(() => { handlers.clear(); localStorage.clear(); });

it("switches suggestions when runtime or project changes", () => {
  setSlashCache("a", "claude", ["cost"]);
  setSlashCache("b", "claude", ["review"]);
  const { rerender } = render(<Terminal base="a" runtime="claude" executionId={null} onStart={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/" } });
  expect(screen.getByRole("button", { name: "/cost" })).toBeInTheDocument();
  rerender(<Terminal base="a" runtime="codex" executionId={null} onStart={() => {}} />);
  expect(screen.queryByRole("button", { name: "/cost" })).not.toBeInTheDocument();
  rerender(<Terminal base="b" runtime="claude" executionId={null} onStart={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/" } });
  expect(screen.queryByRole("button", { name: "/cost" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "/review" })).toBeInTheDocument();
});

it("uses execution runtime on reconnect and persists empty announcements", () => {
  setSlashCache("a", "claude", ["cost"]);
  render(<Terminal base="a" runtime="claude" executionId="exec" onStart={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/" } });
  act(() => handlers.get("execution:catchup")?.({ id: "exec", output: "", running: true, runtime: "codex", slashCommands: [] }));
  expect(screen.queryByRole("button", { name: "/cost" })).not.toBeInTheDocument();
  expect(getSlashCache("a", "claude")).toEqual(["cost"]);
  act(() => handlers.get("execution:slash-commands")?.({ id: "another", runtime: "claude", commands: ["wrong"] }));
  expect(getSlashCache("a", "claude")).toEqual(["cost"]);
  act(() => handlers.get("execution:slash-commands")?.({ id: "exec", runtime: "claude", commands: [] }));
  expect(getSlashCache("a", "claude")).toEqual([]);
});


it("lists all providers, saves the selected model and sends it with matching runtime controls", async () => {
  const models = [
    { model: "codex::gpt-6-astra", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", runtime: "codex", providerId: "codex", providerLabel: "ChatGPT" },
    { model: "kimi::k3", modelId: "k3", displayName: "K3", runtime: "claude", providerId: "kimi", providerLabel: "Kimi" },
  ];
  vi.mocked(api.get).mockImplementation(async (path) => path === "/system/provider"
    ? { selectableModels: models, defaultModel: models[0].model }
    : { model: models[0].model });
  vi.mocked(api.put).mockResolvedValue({ model: models[1].model });
  const start = vi.fn();
  render(<Terminal base="agent:worker" executionId={null} onStart={start} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue(models[0].model));
  expect(screen.getByRole("option", { name: "K3" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: models[1].model } });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue(models[1].model));
  expect(api.put).toHaveBeenCalledWith("/executions/model-preference?targetType=agent&targetName=worker", { model: models[1].model });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Execute" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(start).toHaveBeenCalledWith("Execute", [], expect.objectContaining({ model: "kimi::k3", effort: "high" }));
});


it("keeps Claude Ultracode and GPT Max when switching models and submitting", async () => {
  const models = [
    { model: "anthropic::claude-opus-5", modelId: "claude-opus-5", displayName: "Opus 5", runtime: "claude", providerId: "anthropic", providerLabel: "Claude" },
    { model: "codex::gpt-6-astra", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", runtime: "codex", providerId: "codex", providerLabel: "ChatGPT" },
  ];
  vi.mocked(api.get).mockImplementation(async (path) => path === "/system/provider"
    ? { selectableModels: models, defaultModel: models[0].model }
    : { model: models[0].model });
  vi.mocked(api.put).mockImplementation(async (_path, body) => body);
  const start = vi.fn();
  const { unmount } = render(<Terminal base="agent:thinking" executionId={null} onStart={start} />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue(models[0].model));
  fireEvent.click(screen.getByTitle("Claude effort: High"));
  fireEvent.click(screen.getByRole("button", { name: /^Ultracode/ }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Claude task" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(start).toHaveBeenLastCalledWith("Claude task", [], expect.objectContaining({ model: models[0].model, effort: "ultracode" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: models[1].model } });
  await waitFor(() => expect(screen.getByTitle("ChatGPT thinking: Medium")).toBeInTheDocument());
  fireEvent.click(screen.getByTitle("ChatGPT thinking: Medium"));
  expect(screen.queryByRole("button", { name: /^Ultracode/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Max/ }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "GPT task" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(start).toHaveBeenLastCalledWith("GPT task", [], expect.objectContaining({ model: models[1].model, effort: "max" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: models[0].model } });
  await waitFor(() => expect(screen.getByTitle("Claude effort: Ultracode")).toBeInTheDocument());
  unmount();
  render(<Terminal base="agent:thinking" executionId={null} onStart={start} />);
  await waitFor(() => expect(screen.getByTitle("Claude effort: Ultracode")).toBeInTheDocument());
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: models[1].model } });
  await waitFor(() => expect(screen.getByTitle("ChatGPT thinking: Max")).toBeInTheDocument());
});

it("only exposes isolation omission to an authenticated admin and resets it after sending", () => {
  localStorage.setItem("dashboard_me", JSON.stringify({ role: "admin" }));
  const start = vi.fn();
  render(<Terminal executionId={null} onStart={start} />);
  const checkbox = screen.getByRole("checkbox", { name: "Não enviar isolamento" });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "test" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(start).toHaveBeenCalledWith("test", [], expect.objectContaining({ skipIsolationInstruction: true }));
  expect(checkbox).not.toBeChecked();
});

it("hides isolation omission from regular users and unknown identities", () => {
  const { rerender } = render(<Terminal executionId={null} onStart={vi.fn()} />);
  expect(screen.queryByRole("checkbox", { name: "Não enviar isolamento" })).not.toBeInTheDocument();
  localStorage.setItem("dashboard_me", JSON.stringify({ role: "user" }));
  rerender(<Terminal executionId={null} onStart={vi.fn()} />);
  expect(screen.queryByRole("checkbox", { name: "Não enviar isolamento" })).not.toBeInTheDocument();
});

it("does not offer a prompt change during live message injection", () => {
  localStorage.setItem("dashboard_me", JSON.stringify({ role: "admin" }));
  render(<Terminal executionId="running" isLive onStart={vi.fn()} />);
  expect(screen.queryByRole("checkbox", { name: "Não enviar isolamento" })).not.toBeInTheDocument();
});
