import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { GameLauncher } from "./GameLauncher";

const { handlers, socket, api, addToast } = vi.hoisted(() => {
  const handlers = new Map<string, (data: unknown) => void>();
  return {
    handlers,
    socket: {
      on: vi.fn((event: string, handler: (data: unknown) => void) => handlers.set(event, handler)),
      off: vi.fn((event: string) => handlers.delete(event)),
      emit: vi.fn(),
    },
    api: { get: vi.fn(), post: vi.fn() },
    addToast: vi.fn(),
  };
});
vi.mock("../../lib/socket", () => ({ getSocket: () => socket }));
vi.mock("../../lib/api", () => ({ api, ApiError: class extends Error {} }));
vi.mock("../shared/Toast", () => ({ useToast: () => ({ addToast }) }));

const state = {
  level: 3,
  maxLevel: 7,
  levelsCompleted: 6,
  capacity: 3,
  tubes: [[0, 1, 0], [1, 0, 1], [], []],
  moves: [[0, 2]],
  undosLeft: 4,
  undoLimit: 5,
  moveLimit: 1000,
  status: "playing",
};

beforeEach(() => {
  handlers.clear();
  localStorage.clear();
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
  api.get.mockResolvedValue({ state, availability: "playable" });
});

function openGame() {
  fireEvent.click(screen.getByRole("button", { name: "Jogar Decanta enquanto a execução continua" }));
  return screen.findByRole("dialog", { name: /Decanta/ });
}

it("só oferece o jogo enquanto há um prompt em execução", () => {
  const { rerender } = render(<GameLauncher executionId="exec-1" live={false} awaitingInput={false} />);
  expect(screen.queryByRole("button", { name: /Jogar Decanta/ })).not.toBeInTheDocument();
  rerender(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  expect(screen.getByRole("button", { name: /Jogar Decanta/ })).toBeInTheDocument();
});

it("abre de onde o jogador parou", async () => {
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} activity="Bash" />);
  await openGame();
  expect(api.get).toHaveBeenCalledWith("/game?execId=exec-1");
  expect(await screen.findByText("Fase 3")).toBeInTheDocument();
  expect(screen.getByText("recorde: fase 7")).toBeInTheDocument();
  expect(screen.getByText("2 cores · 3 divisões")).toBeInTheDocument();
  expect(screen.getByText("1 jogada")).toBeInTheDocument();
  expect(screen.getByText("Bash")).toBeInTheDocument();
});

it("some quando a execução faz uma pergunta e volta depois da resposta", async () => {
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openGame();
  act(() => handlers.get("execution:question")?.({ id: "exec-1" }));
  expect(screen.queryByRole("dialog", { name: /Decanta/ })).not.toBeInTheDocument();
  act(() => handlers.get("execution:question:answered")?.({ id: "exec-1" }));
  expect(await screen.findByRole("dialog", { name: /Decanta/ })).toBeInTheDocument();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

it("some enquanto há permissão pendente", async () => {
  const { rerender } = render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openGame();
  rerender(<GameLauncher executionId="exec-1" live awaitingInput />);
  expect(screen.queryByRole("dialog", { name: /Decanta/ })).not.toBeInTheDocument();
  rerender(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  expect(screen.getByRole("dialog", { name: /Decanta/ })).toBeInTheDocument();
});

it("fecha quando a execução termina e avisa que o progresso ficou salvo", async () => {
  const { rerender } = render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  await openGame();
  rerender(<GameLauncher executionId="exec-1" live={false} awaitingInput={false} />);
  expect(screen.queryByRole("dialog", { name: /Decanta/ })).not.toBeInTheDocument();
  expect(addToast).toHaveBeenCalledWith("info", expect.stringContaining("progresso"));
  rerender(<GameLauncher executionId="exec-2" live awaitingInput={false} />);
  expect(screen.getByRole("button", { name: /Jogar Decanta/ })).toBeInTheDocument();
});

it("não abre quando o servidor diz que a execução espera resposta", async () => {
  api.get.mockResolvedValue({ state, availability: "awaiting-input" });
  render(<GameLauncher executionId="exec-1" live awaitingInput={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Jogar Decanta/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /Decanta/ })).not.toBeInTheDocument());
});
