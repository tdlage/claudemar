import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config.js";

let client: QdrantClient | null = null;
let collectionReady = false;
let ensurePromise: Promise<void> | null = null;

export function isEnabled(): boolean {
  return Boolean(config.qdrantUrl && config.qdrantApiKey);
}

export function getClient(): QdrantClient | null {
  if (!isEnabled()) return null;
  if (!client) {
    client = new QdrantClient({ url: config.qdrantUrl, apiKey: config.qdrantApiKey });
  }
  return client;
}

async function indexExists(name: string, field: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const info = await c.getCollection(name);
    const schema = (info?.payload_schema ?? {}) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(schema, field);
  } catch {
    return false;
  }
}

async function ensureCollectionInternal(): Promise<void> {
  const c = getClient();
  if (!c) return;
  const name = config.qdrantCollection;

  let exists = false;
  try {
    const res = await c.collectionExists(name);
    exists = Boolean(res?.exists);
  } catch {
    exists = false;
  }

  if (!exists) {
    await c.createCollection(name, {
      vectors: { dense: { size: config.embeddingDim, distance: "Cosine" } },
      sparse_vectors: config.hybridBm25 ? { bm25: { modifier: "idf" } } : undefined,
    });
  } else {
    const info = await c.getCollection(name);
    const vectors = (info?.config?.params?.vectors ?? {}) as Record<string, { size?: number }> | { size?: number };
    const denseSize = (vectors as Record<string, { size?: number }>).dense?.size ?? (vectors as { size?: number }).size;
    if (denseSize && denseSize !== config.embeddingDim) {
      throw new Error(`Coleção Qdrant '${name}' tem dimensão ${denseSize}, mas EMBEDDING_DIM=${config.embeddingDim}. Ajuste EMBEDDING_DIM/EMBEDDING_MODEL ou recrie a coleção.`);
    }
  }

  for (const field of ["targetType", "targetName", "sourceKey", "current"]) {
    if (!(await indexExists(name, field))) {
      try {
        await c.createPayloadIndex(name, {
          field_name: field,
          field_schema: field === "current" ? "bool" : "keyword",
          wait: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(msg)) throw err;
      }
    }
  }

  collectionReady = true;
}

export async function ensureCollection(): Promise<void> {
  if (!isEnabled() || collectionReady) return;
  if (!ensurePromise) {
    ensurePromise = ensureCollectionInternal().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}
