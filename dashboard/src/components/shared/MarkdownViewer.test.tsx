import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarkdownViewer } from "./MarkdownViewer";

describe("MarkdownViewer", () => {
  it("exibe markdown formatado (não os caracteres literais)", async () => {
    const { container } = render(
      <MarkdownViewer content={"## Título\n\n- item um\n- item dois\n\n**forte**"} />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("h2")?.textContent).toContain("Título");
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector("strong")?.textContent).toBe("forte");
    expect(container.textContent).not.toContain("**forte**");
  });

  it("renderiza link clicável", async () => {
    const { container } = render(
      <MarkdownViewer content={"[claude](https://claude.ai)"} />,
    );
    await waitFor(() => expect(container.querySelector("a")).toBeTruthy());
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://claude.ai");
  });

  it("não executa conteúdo malicioso embutido", async () => {
    const { container } = render(
      <MarkdownViewer content={'oi <script>window.__pwned=1</script> <img src=x onerror="window.__pwned=1">'} />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("aplica a className recebida ao wrapper", async () => {
    const { container } = render(<MarkdownViewer content="oi" className="px-4 py-3" />);
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("markdown-editor");
    expect(wrapper.className).toContain("px-4");
  });
});
