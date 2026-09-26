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
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("../../hooks/useMobile", () => ({ useMobile: () => mobile.value }));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/socket", () => ({ getSocket: () => socket }));
vi.mock("../../hooks/useCurrentModel", () => ({ useCurrentModel: () => ({ runtime: "claude", displayName: "Claude" }) }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

beforeEach(() => { handlers.clear(); localStorage.clear(); mobile.value = false; });

it("keeps a mobile draft while changing options and sends only with the send button", () => {
  mobile.value = true;
  const start = vi.fn();
  render(<Terminal base="mobile" executionId={null} onStart={start} />);
  const field = screen.getByRole("textbox", { name: "Mensagem" });
  fireEvent.change(field, { target: { value: "Primeira linha\nSegunda linha" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Opções da conversa" }));
  expect(screen.getByRole("dialog", { name: "Opções da conversa" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(field).toHaveValue("Primeira linha\nSegunda linha");
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
  expect(start).toHaveBeenCalledWith("Primeira linha\nSegunda linha", [], expect.any(Object));
});

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
  fireEvent.click(screen.getByRole("button", { name: "Opções da conversa" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Opções da conversa" }));
  await waitFor(() => expect(screen.getByTitle("Claude effort: Ultracode")).toBeInTheDocument());
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo" }), { target: { value: models[1].model } });
  await waitFor(() => expect(screen.getByTitle("ChatGPT thinking: Max")).toBeInTheDocument());
});

it("only exposes isolation omission to an authenticated admin and resets it after sending", () => {
  localStorage.setItem("dashboard_me", JSON.stringify({ role: "admin" }));
  const start = vi.fn();
  render(<Terminal executionId={null} onStart={start} />);
  fireEvent.click(screen.getByRole("button", { name: "Opções da conversa" }));
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

it("shows subagent errors inline and retains them when completion omits the error", () => {
  render(<Terminal base="a" executionId="exec" onStart={() => {}} />);
  act(() => handlers.get("execution:task")?.({ id: "exec", phase: "started", taskId: "task", description: "Revisar site", status: "running" }));
  act(() => handlers.get("execution:task")?.({ id: "exec", phase: "updated", taskId: "task", status: "failed", error: "Modelo indisponível" }));
  act(() => handlers.get("execution:task")?.({ id: "exec", phase: "done", taskId: "task", status: "failed" }));
  expect(screen.getByText("Revisar site")).toBeVisible();
  expect(screen.getByText("Falhou: Modelo indisponível")).toBeVisible();
});

it("shows a failed task summary without requiring hover", () => {
  render(<Terminal base="a" executionId="exec" onStart={() => {}} />);
  act(() => handlers.get("execution:task")?.({ id: "exec", phase: "done", taskId: "task", status: "failed", summary: "Credenciais inválidas" }));
  expect(screen.getByText("Falhou: Credenciais inválidas")).toBeVisible();
});

it("keeps secondary controls collapsed and preserves the draft while configuring", () => {
  render(<Terminal executionId={null} onStart={() => {}} controls={<select aria-label="Agente"><option>Sem agente</option></select>} />);
  const field = screen.getByRole("textbox", { name: "Mensagem" });
  fireEvent.change(field, { target: { value: "Minha tarefa" } });
  expect(screen.queryByRole("combobox", { name: "Agente" })).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Opções da conversa" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("region", { name: "Configurações da conversa" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Agente" })).toBeVisible();
  expect(field).toHaveValue("Minha tarefa");
  fireEvent.click(toggle);
  expect(screen.queryByRole("combobox", { name: "Agente" })).not.toBeInTheDocument();
  expect(field).toHaveValue("Minha tarefa");
});

function mockClaudeWithJev(assessment: { complexity: number; confidence: number; effort: string }) {
  const model = "anthropic::claude-opus-5";
  const models = [{ model, modelId: "claude-opus-5", displayName: "Opus 5", runtime: "claude", providerId: "anthropic", providerLabel: "Claude" }];
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === "/system/provider") return { selectableModels: models, defaultModel: model };
    if (path === "/executions/complexity") return { enabled: true };
    return { model };
  });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue(assessment);
}

async function chooseEffort(label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Opções da conversa" }));
  fireEvent.click(screen.getByTitle("Claude effort: High"));
  await screen.findByRole("button", { name: /picks the effort/ });
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function send(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Mensagem" }), { target: { value: text } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Mensagem" }), { key: "Enter" });
}

it("applies the effort recommended by Jev when Auto is selected", async () => {
  mockClaudeWithJev({ complexity: 4, confidence: 0.9, effort: "max" });
  const start = vi.fn();
  render(<Terminal base="project:site" executionId={null} onStart={start} />);
  await chooseEffort(/picks the effort/);
  send("Refatore o módulo de pagamentos");
  await waitFor(() => expect(start).toHaveBeenCalledWith("Refatore o módulo de pagamentos", [], expect.objectContaining({ effort: "max" })));
  expect(api.post).toHaveBeenCalledWith("/executions/complexity", { prompt: "Refatore o módulo de pagamentos", runtime: "claude", targetType: "project", targetName: "site" });
  expect(screen.queryByRole("dialog", { name: "Esforço recomendado" })).not.toBeInTheDocument();
  expect(screen.getByText("Complexidade 4/5 · Max (auto)")).toBeInTheDocument();
});

it("asks which effort to use when the selected effort differs from the recommendation", async () => {
  mockClaudeWithJev({ complexity: 4, confidence: 0.9, effort: "max" });
  const start = vi.fn();
  render(<Terminal base="project:ask" executionId={null} onStart={start} />);
  await chooseEffort(/Best balance of quality/);

  send("Migre o backend");
  expect(await screen.findByRole("dialog", { name: "Esforço recomendado" })).toHaveTextContent("complexidade 4/5");
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Usar Max" }));
  await waitFor(() => expect(start).toHaveBeenLastCalledWith("Migre o backend", [], expect.objectContaining({ effort: "max" })));

  send("Revise a migração");
  await screen.findByRole("dialog", { name: "Esforço recomendado" });
  fireEvent.click(screen.getByRole("button", { name: "Manter High" }));
  await waitFor(() => expect(start).toHaveBeenLastCalledWith("Revise a migração", [], expect.objectContaining({ effort: "high" })));

  send("Descarte isso");
  await screen.findByRole("dialog", { name: "Esforço recomendado" });
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Esforço recomendado" })).not.toBeInTheDocument());
  expect(start).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("textbox", { name: "Mensagem" })).toHaveValue("Descarte isso");
});

it("sends without asking when the selected effort matches, and skips slash commands", async () => {
  mockClaudeWithJev({ complexity: 2, confidence: 0.95, effort: "high" });
  const start = vi.fn();
  render(<Terminal base="project:match" executionId={null} onStart={start} />);
  await chooseEffort(/Best balance of quality/);
  send("Adicione um botão de copiar");
  await waitFor(() => expect(start).toHaveBeenCalledWith("Adicione um botão de copiar", [], expect.objectContaining({ effort: "high" })));
  expect(screen.queryByRole("dialog", { name: "Esforço recomendado" })).not.toBeInTheDocument();
  send("/compact");
  expect(start).toHaveBeenLastCalledWith("/compact", [], expect.objectContaining({ effort: "high" }));
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("keeps the selected effort when the assessment fails", async () => {
  mockClaudeWithJev({ complexity: 0, confidence: 0, effort: "low" });
  vi.mocked(api.post).mockRejectedValue(new Error("Jev respondeu 402"));
  const start = vi.fn();
  render(<Terminal base="project:fail" executionId={null} onStart={start} />);
  await chooseEffort(/Best balance of quality/);
  send("Corrija o login");
  await waitFor(() => expect(start).toHaveBeenCalledWith("Corrija o login", [], expect.objectContaining({ effort: "high" })));
});

it("keeps the running session effort for messages injected into the current execution", async () => {
  mockClaudeWithJev({ complexity: 5, confidence: 0.97, effort: "max" });
  socket.emit.mockClear();
  render(<Terminal base="project:live" executionId="running" isLive onStart={vi.fn()} />);
  await chooseEffort(/Best balance of quality/);
  send("Agora reescreva a camada de persistência");
  expect(socket.emit).toHaveBeenCalledWith("execution:send", { execId: "running", text: "Agora reescreva a camada de persistência" });
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Esforço recomendado" })).not.toBeInTheDocument();
});

it("always uses automatic effort for regular users without offering a manual choice", async () => {
  localStorage.setItem("dashboard_me", JSON.stringify({ role: "user" }));
  mockClaudeWithJev({ complexity: 3, confidence: 0.9, effort: "extra" });
  const start = vi.fn();
  render(<Terminal base="project:user" executionId={null} onStart={start} />);
  fireEvent.click(screen.getByRole("button", { name: "Opções da conversa" }));
  expect(await screen.findByTitle("O esforço é definido automaticamente pela complexidade de cada prompt")).toHaveTextContent("auto");
  expect(screen.queryByTitle(/Claude effort/)).not.toBeInTheDocument();
  send("Corrija o login");
  expect(start).toHaveBeenCalledWith("Corrija o login", [], expect.objectContaining({ effort: undefined }));
  expect(api.post).not.toHaveBeenCalled();
});
