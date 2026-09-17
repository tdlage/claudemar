import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuestionPanel } from "./QuestionPanel";
import type { PendingQuestion } from "../../lib/types";

const question: PendingQuestion = {
  toolUseId: "request-1",
  questions: [{
    header: "Acessos",
    question: "Como tratar as contas existentes?",
    multiSelect: false,
    options: [
      { label: "Preservar os acessos atuais", description: "Restringir apenas novos usuários." },
      { label: "Exigir nova liberação", description: "Revisar todas as contas." },
    ],
  }],
};

describe("QuestionPanel", () => {
  it("mantém a pergunta com opções clicáveis até o envio ser confirmado", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { rerender } = render(<QuestionPanel execId="exec-1" question={question} targetName="GED" runtime="codex" onSubmit={onSubmit} />);
    expect(screen.getByText("Codex precisa de uma resposta")).toBeVisible();
    expect(screen.queryByTitle("Ignorar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Preservar os acessos atuais/ }));
    expect(screen.getByRole("button", { name: /Preservar os acessos atuais/ })).toHaveAttribute("aria-pressed", "true");
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<QuestionPanel execId="exec-1" question={question} targetName="GED" runtime="codex" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(onSubmit).toHaveBeenCalledWith("exec-1", "Como tratar as contas existentes?\nResposta: Preservar os acessos atuais", "request-1", { "Como tratar as contas existentes?": "Preservar os acessos atuais" });
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Pergunta pendente" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Exigir nova liberação/ })).toBeDisabled();
    resolve();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("exibe falha assíncrona e permite reenviar sem perder a escolha", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Falha de conexão")).mockResolvedValue("exec-2");
    render(<QuestionPanel execId="exec-1" question={question} targetName="GED" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Exigir nova liberação/ }));
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de conexão");
    expect(screen.getByRole("button", { name: /Exigir nova liberação/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aceita texto livre e identifica a resposta de cada pergunta", async () => {
    const onSubmit = vi.fn().mockResolvedValue("exec-2");
    const multiple = { ...question, questions: [...question.questions, { header: "Nome", question: "Qual nome usar?", multiSelect: false, options: [] }] };
    render(<QuestionPanel execId="exec-1" question={multiple} targetName="GED" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Preservar os acessos atuais/ }));
    expect(screen.getByRole("button", { name: "Responder" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Qual nome usar/ }), { target: { value: "Administradores" } });
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("exec-1", "Como tratar as contas existentes?\nResposta: Preservar os acessos atuais\n\nQual nome usar?\nResposta: Administradores", "request-1", { "Como tratar as contas existentes?": "Preservar os acessos atuais", "Qual nome usar?": "Administradores" }));
  });

  it("alterna entre texto livre e múltiplas opções sem conservar texto oculto", async () => {
    const onSubmit = vi.fn().mockResolvedValue("exec-2");
    const multi = { ...question, questions: [{ ...question.questions[0], multiSelect: true }] };
    render(<QuestionPanel execId="exec-1" question={multi} targetName="GED" runtime="claude" onSubmit={onSubmit} />);
    expect(screen.getByText("Claude precisa de uma resposta")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Personalizado" } });
    fireEvent.click(screen.getByRole("button", { name: /Preservar os acessos atuais/ }));
    fireEvent.click(screen.getByRole("button", { name: /Exigir nova liberação/ }));
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("exec-1", "Como tratar as contas existentes?\nResposta: Preservar os acessos atuais, Exigir nova liberação", "request-1", { "Como tratar as contas existentes?": "Preservar os acessos atuais, Exigir nova liberação" }));
  });
});
