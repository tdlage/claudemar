import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditableMarkdownField } from "./EditableMarkdownField";

describe("EditableMarkdownField", () => {
  it("mostra o conteúdo formatado em modo leitura", async () => {
    const { container } = render(
      <EditableMarkdownField value={"**oi** mundo"} onSave={vi.fn()} editable />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("strong")?.textContent).toBe("oi");
  });

  it("exibe emptyLabel quando vazio e esconde o botão editar quando não editável", async () => {
    render(<EditableMarkdownField value="" onSave={vi.fn()} editable={false} emptyLabel="Sem descrição." />);
    expect(screen.getByText("Sem descrição.")).toBeInTheDocument();
    expect(screen.queryByTitle("Editar")).toBeNull();
  });

  it("entra em edição pelo botão e mostra a toolbar do rich editor", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<EditableMarkdownField value={"texto inicial"} onSave={vi.fn()} editable />);
    const editBtn = await screen.findByTitle("Editar");
    await user.click(editBtn);
    expect(await screen.findByTitle("Bold")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Concluir/i })).toBeInTheDocument();
  });

  it("não chama onSave quando o conteúdo não muda ao concluir", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSave = vi.fn();
    render(<EditableMarkdownField value={"sem mudanca"} onSave={onSave} editable />);
    await user.click(await screen.findByTitle("Editar"));
    await user.click(await screen.findByRole("button", { name: /Concluir/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Concluir/i })).toBeNull());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("persiste como markdown quando o conteúdo é editado", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSave = vi.fn();
    render(<EditableMarkdownField value={"inicial"} onSave={onSave} editable />);
    await user.click(await screen.findByTitle("Editar"));
    const editable = document.querySelector(".tiptap") as HTMLElement;
    await waitFor(() => expect(editable).toBeTruthy());
    editable.focus();
    await user.keyboard("X");
    await user.click(await screen.findByRole("button", { name: /Concluir/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as string;
    expect(typeof saved).toBe("string");
    expect(saved).toContain("inicial");
    expect(saved.length).toBeGreaterThan("inicial".length);
  });
});
