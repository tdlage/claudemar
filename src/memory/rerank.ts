import { config } from "../config.js";

const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";

interface VoyageRerankResponse {
  data?: Array<{ index: number; relevance_score: number }>;
}

export async function rerank(
  query: string,
  docs: string[],
  instruction: string,
  topK: number,
): Promise<{ index: number; score: number }[]> {
  if (docs.length === 0) return [];
  if (!config.voyageApiKey) {
    throw new Error("Memória de longo prazo ativa mas VOYAGE_API_KEY não está configurada. Defina VOYAGE_API_KEY ou desative a memória (remova QDRANT_URL).");
  }

  const res = await fetch(VOYAGE_RERANK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.voyageApiKey}`,
    },
    body: JSON.stringify({
      model: config.rerankModel,
      query,
      documents: docs,
      top_k: Math.min(topK, docs.length),
      ...(instruction ? { instruction } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Falha ao reordenar resultados na Voyage (HTTP ${res.status}): ${detail || res.statusText}`);
  }

  const json = (await res.json()) as VoyageRerankResponse;
  return (json.data ?? []).map((item) => ({ index: item.index, score: item.relevance_score }));
}
