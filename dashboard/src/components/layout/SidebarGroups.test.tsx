import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { SidebarGroups, type SidebarGroup } from "./SidebarGroups";

const storageKey = "sidebar-groups-test";
const groups: SidebarGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    compact: true,
    content: <a href="/">Visão geral</a>,
  },
  {
    id: "projects",
    label: "Seus projetos",
    action: <button>Novo projeto</button>,
    content: <a href="/projects/qualichart">Qualichart</a>,
  },
  {
    id: "agents",
    label: "Seus agentes",
    content: <a href="/agents/revisor">Revisor</a>,
  },
  {
    id: "admin",
    label: "Administração",
    compact: true,
    content: <a href="/settings">Configurações</a>,
  },
];
const labels = () =>
  screen
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-label"));
beforeEach(() => localStorage.clear());

it("collapses with the keyboard, keeps creation available and restores the saved state", async () => {
  const user = userEvent.setup();
  const { unmount } = render(
    <SidebarGroups groups={groups} expanded storageKey={storageKey} />,
  );
  const toggle = screen.getByRole("button", {
    name: "Seus projetos",
    exact: true,
  });
  toggle.focus();
  await user.keyboard("{Enter}");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("link", { name: "Qualichart" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Novo projeto" })).toBeVisible();
  unmount();
  render(<SidebarGroups groups={groups} expanded storageKey={storageKey} />);
  expect(
    screen.getByRole("button", { name: "Seus projetos", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await user.click(
    screen.getByRole("button", { name: "Seus projetos", exact: true }),
  );
  expect(screen.getByRole("link", { name: "Qualichart" })).toBeVisible();
});

it("reorders actual DOM navigation, keeps keyboard focus and persists across remounts", async () => {
  const user = userEvent.setup();
  const { unmount } = render(
    <SidebarGroups groups={groups} expanded storageKey={storageKey} />,
  );
  await user.click(screen.getByRole("button", { name: "Organizar menu" }));
  const move = screen.getByRole("button", {
    name: "Mover Seus projetos para cima",
  });
  move.focus();
  await user.keyboard("{Enter}");
  expect(labels()).toEqual([
    "Seus projetos",
    "Workspace",
    "Seus agentes",
    "Administração",
  ]);
  expect(move).toHaveFocus();
  expect(move).toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Enter}");
  expect(labels()[0]).toBe("Seus projetos");
  expect(screen.getByRole("status")).toHaveTextContent("posição 1 de 4");
  await user.click(
    screen.getByRole("button", { name: "Mover Administração para baixo" }),
  );
  expect(labels()[3]).toBe("Administração");
  await user.click(
    screen.getByRole("button", { name: "Concluir organização" }),
  );
  expect(
    screen.queryByRole("button", { name: /Mover/ }),
  ).not.toBeInTheDocument();
  unmount();
  render(<SidebarGroups groups={groups} expanded storageKey={storageKey} />);
  expect(labels()).toEqual([
    "Seus projetos",
    "Workspace",
    "Seus agentes",
    "Administração",
  ]);
});

it("retains icon navigation when the whole sidebar is compact", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <SidebarGroups groups={groups} expanded storageKey={storageKey} />,
  );
  await user.click(
    screen.getByRole("button", { name: "Workspace", exact: true }),
  );
  rerender(
    <SidebarGroups groups={groups} expanded={false} storageKey={storageKey} />,
  );
  expect(screen.getByRole("link", { name: "Visão geral" })).toBeVisible();
  expect(labels()).toEqual(["Workspace", "Administração"]);
  expect(
    screen.queryByRole("button", { name: "Organizar menu" }),
  ).not.toBeInTheDocument();
  rerender(<SidebarGroups groups={groups} expanded storageKey={storageKey} />);
  expect(
    screen.queryByRole("link", { name: "Visão geral" }),
  ).not.toBeInTheDocument();
});

it("ignores stale groups, appends newly available groups and never renders unauthorized content", () => {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      order: ["admin", "removed", "agents", "agents"],
      collapsed: ["agents"],
    }),
  );
  render(
    <SidebarGroups
      groups={groups.filter((group) => group.id !== "admin")}
      expanded
      storageKey={storageKey}
    />,
  );
  expect(labels()).toEqual(["Seus agentes", "Workspace", "Seus projetos"]);
  expect(
    screen.queryByRole("link", { name: "Configurações" }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Seus agentes" })).queryByRole(
      "link",
    ),
  ).not.toBeInTheDocument();
});

it("recovers from corrupted preferences", () => {
  localStorage.setItem(storageKey, "{broken");
  render(<SidebarGroups groups={groups} expanded storageKey={storageKey} />);
  expect(labels()).toEqual(groups.map((group) => group.label));
  expect(screen.getByRole("link", { name: "Qualichart" })).toBeVisible();
});
