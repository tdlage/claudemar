import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PipelineCardItem } from "./PipelineCardItem";
import { ToastProvider } from "../shared/Toast";
import { api } from "../../lib/api";
import type { PipelineCard, PipelineCardStatus, PipelineStage } from "../../lib/types";

vi.mock("../../lib/api", () => ({
  api: { post: vi.fn().mockResolvedValue({}) },
}));

const postMock = vi.mocked(api.post);

function makeCard(overrides: Partial<PipelineCard> = {}): PipelineCard {
  return {
    id: "card-1",
    pipelineId: "pipe-1",
    seqNumber: 7,
    title: "Card de teste",
    stage: "requirement" as PipelineStage,
    status: "awaiting_gate" as PipelineCardStatus,
    auto: false,
    originType: "manual",
    originRef: null,
    intakeInput: "",
    requirementText: "",
    planMarkdown: "",
    sessionId: null,
    implementationRetries: 0,
    codeReviewRetries: 0,
    e2eRetries: 0,
    position: 0,
    lastFeedback: null,
    createdBy: "user",
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    repos: [],
    ...overrides,
  };
}

function renderCard(card: PipelineCard, onClick = vi.fn()) {
  render(
    <ToastProvider>
      <PipelineCardItem card={card} projectName="claudemar" onClick={onClick} />
    </ToastProvider>,
  );
  return { onClick };
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({});
});

describe("PipelineCardItem — botão de ação inline", () => {
  it("mostra 'Aprovar' e chama advance quando awaiting_gate (critério 1)", async () => {
    renderCard(makeCard({ status: "awaiting_gate", stage: "requirement" }));
    const btn = screen.getByRole("button", { name: "Aprovar" });
    await userEvent.click(btn);
    expect(postMock).toHaveBeenCalledOnce();
    expect(postMock).toHaveBeenCalledWith("/pipeline/cards/card-1/advance");
  });

  it("mostra 'Concluir' no estágio monitor (critério 1)", () => {
    renderCard(makeCard({ status: "awaiting_gate", stage: "monitor" }));
    expect(screen.getByRole("button", { name: "Concluir" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
  });

  it("mostra 'Iniciar' e chama retry quando idle (critério 2)", async () => {
    renderCard(makeCard({ status: "idle" }));
    await userEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    expect(postMock).toHaveBeenCalledOnce();
    expect(postMock).toHaveBeenCalledWith("/pipeline/cards/card-1/retry");
  });

  it.each<PipelineCardStatus>(["running", "done", "failed"])(
    "não mostra botão de ação inline quando status=%s (critério 3)",
    (status) => {
      renderCard(makeCard({ status }));
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("o clique no botão não abre o detalhe — stopPropagation (critério 4)", async () => {
    const { onClick } = renderCard(makeCard({ status: "awaiting_gate" }));
    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledOnce();
  });

  it("o clique no corpo do card abre o detalhe (não-regressão do onClick)", async () => {
    const { onClick } = renderCard(makeCard({ status: "awaiting_gate" }));
    await userEvent.click(screen.getByText("Card de teste"));
    expect(onClick).toHaveBeenCalledOnce();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("desabilita o botão enquanto a requisição está pendente (critério 5)", async () => {
    let resolve!: () => void;
    postMock.mockReturnValueOnce(new Promise<unknown>((r) => { resolve = () => r({}); }));
    renderCard(makeCard({ status: "awaiting_gate" }));
    const btn = screen.getByRole("button", { name: "Aprovar" });
    await userEvent.click(btn);
    expect(btn).toBeDisabled();
    resolve();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it("mostra toast de erro e libera o botão em caso de falha (critério 6)", async () => {
    postMock.mockRejectedValueOnce(new Error("Falha no gate"));
    renderCard(makeCard({ status: "awaiting_gate" }));
    const btn = screen.getByRole("button", { name: "Aprovar" });
    await userEvent.click(btn);
    expect(await screen.findByText("Falha no gate")).toBeInTheDocument();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("PipelineCardItem — indicador de modo automático", () => {
  it("exibe o badge 'Auto' quando auto=true (critério 8)", () => {
    renderCard(makeCard({ auto: true, status: "idle" }));
    expect(screen.getByTitle("Modo automático")).toBeInTheDocument();
  });

  it("não exibe o badge 'Auto' quando auto=false (critério 8)", () => {
    renderCard(makeCard({ auto: false, status: "idle" }));
    expect(screen.queryByTitle("Modo automático")).not.toBeInTheDocument();
  });

  it("mostra 'Auto' e 'Executando' simultaneamente sem ambiguidade (critério 9)", () => {
    renderCard(makeCard({ auto: true, status: "running" }));
    expect(screen.getByTitle("Modo automático")).toBeInTheDocument();
    expect(screen.getByText("Executando")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("card auto em awaiting_gate ainda mostra o botão de aprovação (critério 10)", () => {
    renderCard(makeCard({ auto: true, status: "awaiting_gate", stage: "plan" }));
    expect(screen.getByTitle("Modo automático")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
  });
});
