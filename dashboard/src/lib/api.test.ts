import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./api";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api.get — dedupe de requisições em voo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs concorrentes à mesma rota compartilham um único fetch", async () => {
    let release!: (r: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );

    const p1 = api.get<{ ok: boolean }>("/executions");
    const p2 = api.get<{ ok: boolean }>("/executions");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(jsonResponse({ ok: true }));
    await expect(p1).resolves.toEqual({ ok: true });
    await expect(p2).resolves.toEqual({ ok: true });
  });

  it("após resolver, uma nova chamada dispara novo fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ n: 1 }))
      .mockResolvedValueOnce(jsonResponse({ n: 2 }));

    await expect(api.get("/agents/Jarvis")).resolves.toEqual({ n: 1 });
    await expect(api.get("/agents/Jarvis")).resolves.toEqual({ n: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rotas diferentes não compartilham fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({}));

    await Promise.all([api.get("/a"), api.get("/b")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falha não fica presa no cache de voo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(api.get("/x")).rejects.toThrow("boom");
    await expect(api.get("/x")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("api — mensagens de erro", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("usa a mensagem enviada pelo servidor", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "As imagens somam 40.0 MB; o limite é 32.0 MB por mensagem." }), { status: 413 }));
    await expect(api.post("/executions", { prompt: "x" })).rejects.toThrow("As imagens somam 40.0 MB; o limite é 32.0 MB por mensagem.");
  });

  it("explica um 413 do proxy que não responde JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>413 Request Entity Too Large</html>", { status: 413 }));
    await expect(api.post("/executions", { prompt: "x" })).rejects.toThrow("O envio é maior que o limite aceito pelo servidor.");
  });

  it("nunca produz mensagem vazia quando o status não tem texto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502, statusText: "" }));
    await expect(api.post("/executions", { prompt: "x" })).rejects.toThrow("Erro HTTP 502");
  });
});
