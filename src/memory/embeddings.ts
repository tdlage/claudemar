import { config } from "../config.js";

const VOYAGE_EMBED_URL = "https://api.voyageai.com/v1/embeddings";
const MAX_BATCH_COUNT = 128;
const MAX_BATCH_TOKENS = 100_000;

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    const t = approxTokens(text);
    if (current.length > 0 && (current.length >= MAX_BATCH_COUNT || tokens + t > MAX_BATCH_TOKENS)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += t;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!config.voyageApiKey) {
    throw new Error("Memória de longo prazo ativa mas VOYAGE_API_KEY não está configurada. Defina VOYAGE_API_KEY ou desative a memória (remova QDRANT_URL).");
  }

  const results: number[][] = [];
  for (const batch of buildBatches(texts)) {
    const res = await fetch(VOYAGE_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.voyageApiKey}`,
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: batch,
        input_type: inputType,
        output_dimension: config.embeddingDim,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Falha ao gerar embeddings na Voyage (HTTP ${res.status}): ${detail || res.statusText}`);
    }

    const json = (await res.json()) as VoyageEmbeddingResponse;
    const data = (json.data ?? []).slice().sort((a, b) => a.index - b.index);
    if (data.length !== batch.length) {
      throw new Error(`Resposta de embeddings da Voyage incompleta: esperados ${batch.length}, recebidos ${data.length}.`);
    }
    for (const item of data) results.push(item.embedding);
  }

  return results;
}
