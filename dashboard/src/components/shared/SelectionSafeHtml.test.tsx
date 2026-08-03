import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { SelectionSafeHtml } from "./SelectionSafeHtml";

function mockSelection(getAnchor: () => Node | null, collapsed: () => boolean) {
  vi.spyOn(window, "getSelection").mockImplementation(() => ({
    get isCollapsed() { return collapsed(); },
    get anchorNode() { return getAnchor(); },
    get focusNode() { return getAnchor(); },
  }) as unknown as Selection);
}

describe("SelectionSafeHtml", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("atualiza o HTML normalmente sem seleção ativa", () => {
    const { container, rerender } = render(<SelectionSafeHtml html="<span>um</span>" />);
    rerender(<SelectionSafeHtml html="<span>dois</span>" />);
    expect(container.textContent).toBe("dois");
  });

  it("adia a atualização enquanto houver seleção dentro e aplica ao soltar", async () => {
    const { container, rerender } = render(<SelectionSafeHtml html="<span>original</span>" />);
    let selecting = true;
    mockSelection(
      () => (selecting ? container.querySelector("span")!.firstChild : null),
      () => !selecting,
    );

    rerender(<SelectionSafeHtml html="<span>atualizado</span>" />);
    expect(container.textContent).toBe("original");

    rerender(<SelectionSafeHtml html="<span>atualizado</span>" />);
    expect(container.textContent).toBe("original");

    selecting = false;
    document.dispatchEvent(new Event("selectionchange"));
    await waitFor(() => expect(container.textContent).toBe("atualizado"));
  });

  it("seleção fora do componente não bloqueia a atualização", () => {
    const outside = document.createElement("p");
    outside.textContent = "texto externo";
    document.body.appendChild(outside);
    try {
      const { container, rerender } = render(<SelectionSafeHtml html="<span>um</span>" />);
      mockSelection(() => outside.firstChild, () => false);

      rerender(<SelectionSafeHtml html="<span>dois</span>" />);
      expect(container.textContent).toBe("dois");
    } finally {
      outside.remove();
    }
  });
});
