import { describe, expect, it } from "vitest";
import { formatToolUse } from "../../../src/providers/format";
import { renderOutputHtml } from "./ansi";

function render(text: string): HTMLDivElement {
  const element = document.createElement("div");
  element.innerHTML = renderOutputHtml(text);
  return element;
}

describe("renderOutputHtml", () => {
  it("keeps explanations between commands outside command blocks", () => {
    const output = render(
      formatToolUse("Bash", { command: "cat schedule.ts" }) +
      "Confirmei problemas nos turnos. Vou corrigir esses caminhos.\n" +
      formatToolUse("Read", { file_path: "schedule.ts" }),
    );

    expect(output.querySelectorAll("blockquote")).toHaveLength(2);
    expect(output.children[1].tagName).toBe("P");
    expect(output.children[1].textContent).toBe("Confirmei problemas nos turnos. Vou corrigir esses caminhos.");
    expect(output.querySelector("blockquote")?.textContent).toBe("Bash cat schedule.ts");
  });

  it("preserves code blocks, inline code and ordinary Markdown quotes", () => {
    const output = render(
      formatToolUse("Bash", { command: "pwd" }) +
      "Use `slot.start`:\n\n```ts\nconst start = slot.start;\n```\n\n> Uma citação\n",
    );

    expect(output.querySelector("pre code")?.textContent).toBe("const start = slot.start;\n");
    expect(output.querySelector("p > code")?.textContent).toBe("slot.start");
    expect(output.querySelectorAll("blockquote")[1].textContent).toContain("Uma citação");
  });

  it("treats multiline commands as literal text without swallowing following prose", () => {
    const command = "echo '<img src=x onerror=alert(1)>'\n# **literal**";
    const output = render(formatToolUse("Bash", { command }) + "Explicação seguinte.");

    expect(output.querySelector("blockquote")?.textContent).toBe(`Bash ${command.replace("\n", "")}`);
    expect(output.querySelector("img, strong, h1")).toBeNull();
    expect(output.lastElementChild?.tagName).toBe("P");
    expect(output.lastElementChild?.textContent).toBe("Explicação seguinte.");
  });
});
