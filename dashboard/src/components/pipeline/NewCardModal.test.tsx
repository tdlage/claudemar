import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NewCardModal } from "./PipelineBoard";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: { post: vi.fn().mockResolvedValue({}) },
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

describe("NewCardModal — seleção de repositórios (claudemar#7 critérios 6,7,9)", () => {
  beforeEach(() => postMock.mockClear());

  it("habilita 'Criar card' com seleção vazia e envia repos: [] (backend inclui todos via fallback)", async () => {
    const onCreated = vi.fn();
    const { getByText, getByPlaceholderText } = render(
      <NewCardModal pipelineId="pipe-1" repos={["claudemar", "infra"]} onClose={() => {}} onCreated={onCreated} />,
    );

    fireEvent.change(getByPlaceholderText("Título da tarefa"), { target: { value: "Minha tarefa" } });

    const createBtn = getByText("Criar card");
    expect(createBtn).not.toBeDisabled();

    fireEvent.click(createBtn);

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(
      "/pipeline/pipe-1/cards",
      expect.objectContaining({ title: "Minha tarefa", repos: [] }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("permite múltipla seleção e envia os repositórios marcados", async () => {
    const { getByText, getByPlaceholderText } = render(
      <NewCardModal pipelineId="pipe-1" repos={["claudemar", "infra"]} onClose={() => {}} onCreated={() => {}} />,
    );

    fireEvent.change(getByPlaceholderText("Título da tarefa"), { target: { value: "T" } });
    fireEvent.click(getByText("claudemar"));
    fireEvent.click(getByText("infra"));

    fireEvent.click(getByText("Criar card"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(
      "/pipeline/pipe-1/cards",
      expect.objectContaining({ repos: ["claudemar", "infra"] }),
    );
  });

  it("mantém 'Criar card' desabilitado sem título", () => {
    const { getByText } = render(
      <NewCardModal pipelineId="pipe-1" repos={["claudemar"]} onClose={() => {}} onCreated={() => {}} />,
    );
    expect(getByText("Criar card")).toBeDisabled();
  });
});
