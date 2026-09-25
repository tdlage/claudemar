import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { Tabs } from "./Tabs";
import { ThemeToggle } from "./ThemeToggle";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { openCreateWorkspace } from "../../lib/workspaceEvents";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({ api: { post: vi.fn() } }));
vi.mock("../../hooks/useMobile", () => ({ useMobile: () => false }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "bridge";
  vi.mocked(api.post).mockReset();
});

describe("workspace navigation", () => {
  it("moves between sections with arrows, Home and End without extra tab stops", () => {
    function Example() {
      const [active, setActive] = useState("chat");
      return (
        <Tabs
          tabs={[
            { key: "chat", label: "Conversa" },
            { key: "files", label: "Arquivos" },
            { key: "settings", label: "Configurações" },
          ]}
          active={active}
          onChange={setActive}
        />
      );
    }
    render(<Example />);
    const chat = screen.getByRole("tab", { name: "Conversa" });
    chat.focus();
    fireEvent.keyDown(chat, { key: "ArrowLeft" });
    const settings = screen.getByRole("tab", { name: "Configurações" });
    expect(settings).toHaveFocus();
    expect(settings).toHaveAttribute("aria-selected", "true");
    expect(chat).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(settings, { key: "Home" });
    expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: "End" });
    expect(settings).toHaveFocus();
  });

  it("persists the selected theme and keeps multiple controls in sync", () => {
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Usar tema claro (Paper)" })[0],
    );
    expect(localStorage.getItem("claudemar_theme")).toBe("paper");
    expect(document.documentElement.dataset.theme).toBe("paper");
    expect(
      screen.getAllByRole("button", { name: "Usar tema escuro (Bridge)" }),
    ).toHaveLength(2);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "claudemar_theme",
          newValue: "bridge",
        }),
      );
    });
    expect(
      screen.getAllByRole("button", { name: "Usar tema claro (Paper)" }),
    ).toHaveLength(2);
  });
});

describe("workspace creation", () => {
  it("validates the entered name without silently removing characters and preserves it after API failure", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Project already exists"));
    render(
      <MemoryRouter>
        <CreateWorkspaceModal />
      </MemoryRouter>,
    );
    act(() => openCreateWorkspace("projects"));
    const dialog = screen.getByRole("dialog", { name: "Novo projeto" });
    const name = within(dialog).getByRole("textbox", {
      name: "Nome do projeto",
    });
    fireEvent.change(name, { target: { value: "meu projeto" } });
    fireEvent.submit(name.closest("form")!);
    expect(name).toHaveValue("meu projeto");
    expect(api.post).not.toHaveBeenCalled();
    expect(name).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(name, { target: { value: "meu-projeto" } });
    fireEvent.submit(name.closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Já existe um projeto",
      ),
    );
    expect(name).toHaveValue("meu-projeto");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks duplicate submissions and closing while a creation is pending", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <MemoryRouter>
        <CreateWorkspaceModal />
      </MemoryRouter>,
    );
    act(() => openCreateWorkspace("agents"));
    const input = screen.getByRole("textbox", { name: "Nome do agente" });
    fireEvent.change(input, { target: { value: "revisor" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(input).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      finish({ name: "revisor" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not expose creation to ordinary users", () => {
    localStorage.setItem(
      "dashboard_me",
      JSON.stringify({
        role: "user",
        projects: [],
        agents: [],
      }),
    );
    render(
      <MemoryRouter>
        <CreateWorkspaceModal />
      </MemoryRouter>,
    );
    act(() => openCreateWorkspace("projects"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
