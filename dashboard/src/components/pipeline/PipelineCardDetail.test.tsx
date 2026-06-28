import { describe, it, expect } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { RunArtifacts } from "./PipelineCardDetail";
import type { PipelineStage, PipelineStageArtifacts, PipelineStageRun } from "../../lib/types";

function makeRun(artifacts: PipelineStageArtifacts): PipelineStageRun {
  return {
    id: "run-1",
    cardId: "card-1",
    stage: "requirement" as PipelineStage,
    attempt: 1,
    execId: null,
    sessionId: null,
    status: "passed",
    promptSent: "",
    output: "",
    artifacts,
    costUsd: 0,
    totalTokens: 0,
    contextPct: 0,
    startedAt: "2026-06-27T00:00:00.000Z",
    finishedAt: "2026-06-27T00:00:00.000Z",
  };
}

describe("RunArtifacts — markdown formatado (claudemar#6)", () => {
  it("renderiza o requisito como markdown formatado, não texto literal (critério 1)", async () => {
    const { container } = render(
      <RunArtifacts run={makeRun({ requirement: "## Objetivo\n\n- um\n- dois\n\n**forte**" })} />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("h2")?.textContent).toContain("Objetivo");
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector("strong")?.textContent).toBe("forte");
    expect(container.textContent).not.toContain("**forte**");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renderiza o plano como markdown e mantém a linha 'Repos:' (critério 2)", async () => {
    const { container, getByText } = render(
      <RunArtifacts run={makeRun({ plan: { markdown: "# Plano\n\ntexto", repos: ["claudemar", "infra"] } })} />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("h1")?.textContent).toContain("Plano");
    expect(getByText("Repos: claudemar, infra")).toBeInTheDocument();
  });

  it("renderiza o resumo do review como markdown e mantém o cabeçalho de status (critério 3)", async () => {
    const { container, getByText } = render(
      <RunArtifacts
        run={makeRun({ review: { totalFindings: 3, fixed: 2, clean: false, testsPass: true, summary: "### Achados\n\n`bug`" } })}
      />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("h3")?.textContent).toContain("Achados");
    expect(container.querySelector("code")?.textContent).toBe("bug");
    expect(getByText(/Code review: 2\/3 corrigidos/)).toBeInTheDocument();
  });

  it("renderiza link clicável com rel seguro (critério 4)", async () => {
    const { container } = render(
      <RunArtifacts run={makeRun({ requirement: "[claude](https://claude.ai)" })} />,
    );
    await waitFor(() => expect(container.querySelector("a")).toBeTruthy());
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://claude.ai");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("mantém logs de testes e e2e como texto plano em <pre> (critério 5)", async () => {
    const { container } = render(
      <RunArtifacts
        run={makeRun({
          tests: { passed: true, total: 2, failed: 0, logs: "## não-markdown\nlinha de log" },
          e2e: { passed: true, screenshots: [], logs: "e2e log\noutra linha" },
        })}
      />,
    );
    const pres = container.querySelectorAll("pre");
    expect(pres.length).toBe(2);
    expect(pres[0].textContent).toContain("## não-markdown");
    expect(within(pres[0] as HTMLElement).queryByRole("heading")).toBeNull();
    expect(pres[1].textContent).toContain("e2e log");
  });

  it("não renderiza bloco algum quando os artefatos estão ausentes (critério 7)", () => {
    const { container } = render(<RunArtifacts run={makeRun({})} />);
    expect(container.querySelector(".tiptap")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent?.trim()).toBe("");
  });

  it("não executa conteúdo malicioso embutido no markdown", async () => {
    const { container } = render(
      <RunArtifacts run={makeRun({ requirement: 'oi <script>window.__pwned=1</script> <img src=x onerror="window.__pwned=1">' })} />,
    );
    await waitFor(() => expect(container.querySelector(".tiptap")).toBeTruthy());
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });
});
