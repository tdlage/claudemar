import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BoardLanes } from "./BoardLanes";
import { Modal } from "./Modal";
import { MonacoEditorWrapper } from "../editor/MonacoEditor";

vi.mock("../../hooks/useMobile", () => ({ useMobile: () => true }));

it("lets touch users switch board stages and recovers when a stage disappears", () => {
  const lanes = [{ id: "todo", label: "A fazer", count: 0 }, { id: "doing", label: "Em andamento", count: 1 }];
  const { rerender } = render(<BoardLanes lanes={lanes}><div>Coluna vazia</div><div>Tarefa em andamento</div></BoardLanes>);
  expect(screen.getByText("Tarefa em andamento")).toBeInTheDocument();
  expect(screen.queryByText("Coluna vazia")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "todo" } });
  expect(screen.getByText("Coluna vazia")).toBeInTheDocument();
  rerender(<BoardLanes lanes={[lanes[1]]}><div>Tarefa em andamento</div></BoardLanes>);
  expect(screen.getByText("Tarefa em andamento")).toBeInTheDocument();
});

it("closes only the top dialog and restores focus to its opener", () => {
  function Example() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    return <><button onClick={() => setOuter(true)}>Opções</button>
      <Modal open={outer} onClose={() => setOuter(false)} title="Opções da conversa">
        <button onClick={() => setInner(true)}>Escolher esforço</button>
        <Modal open={inner} onClose={() => setInner(false)} title="Esforço">Opções do modelo</Modal>
      </Modal>
    </>;
  }
  render(<Example />);
  const opener = screen.getByRole("button", { name: "Opções" });
  opener.focus(); fireEvent.click(opener);
  const effort = screen.getByRole("button", { name: "Escolher esforço" });
  effort.focus(); fireEvent.click(effort);
  expect(screen.getByRole("dialog", { name: "Esforço" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Esforço" })).not.toBeInTheDocument();
  expect(effort).toHaveFocus();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(opener).toHaveFocus();
});

it("edits code with a native mobile field and honors read-only access", () => {
  const change = vi.fn(), save = vi.fn();
  const { rerender } = render(<MonacoEditorWrapper content={"linha 1\nlinha 2"} onChange={change} onSave={save} goToLine={2} />);
  const editor = screen.getByRole("textbox", { name: "Conteúdo do arquivo" });
  expect((editor as HTMLTextAreaElement).selectionStart).toBe(8);
  fireEvent.change(editor, { target: { value: "texto editado" } });
  expect(change).toHaveBeenCalledWith("texto editado");
  fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
  expect(save).toHaveBeenCalledOnce();
  rerender(<MonacoEditorWrapper content="leitura" onChange={change} readOnly />);
  expect(editor).toHaveAttribute("readonly");
});
