import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { markdownExtensions, getEditorMarkdown } from "./markdownTiptap";

function makeEditor(content: string, editable = false) {
  return new Editor({
    extensions: markdownExtensions({ editable }),
    content,
    editable,
  });
}

const SAMPLE = "## Título\n\n- a\n- b\n\n**negrito** e `code`";

describe("markdownExtensions", () => {
  it("renderiza markdown formatado como HTML (heading, lista, negrito, código)", () => {
    const editor = makeEditor(SAMPLE);
    const html = editor.getHTML();
    expect(html).toContain("<h2>");
    expect(html).toContain("Título");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("<strong>negrito</strong>");
    expect(html).toContain("<code>code</code>");
    editor.destroy();
  });

  it("faz round-trip markdown→editor→markdown estável", () => {
    const editor = makeEditor(SAMPLE);
    const out = getEditorMarkdown(editor);
    const reloaded = makeEditor(out);
    expect(getEditorMarkdown(reloaded)).toBe(out);
    expect(out).toContain("## Título");
    expect(out).toContain("**negrito**");
    expect(out).toContain("`code`");
    editor.destroy();
    reloaded.destroy();
  });

  it("não renderiza HTML arbitrário (script é neutralizado por html:false)", () => {
    const editor = makeEditor("antes <script>window.__pwned=1</script> depois");
    const html = editor.getHTML();
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    editor.destroy();
  });

  it("não cria elementos reais a partir de HTML embutido (img onerror)", () => {
    const editor = makeEditor('texto <img src=x onerror="window.__pwned=1"> fim');
    const html = editor.getHTML();
    expect(html).not.toContain("<img");
    editor.destroy();
  });
});
