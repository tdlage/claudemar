import Anthropic from "@anthropic-ai/sdk";
import { brainSettingsManager } from "./settings.js";
import { incrMetric } from "./redis.js";
import { sha256Hex } from "./text.js";
import type { BrainLlmProvider, BrainStageLlm } from "./types.js";

export type BrainLlmStage = "triage" | "compile" | "selector" | "distill" | "lint" | "chat";

interface ResolvedStage {
  provider: BrainLlmProvider;
  model: string;
  apiKey: string;
}

const clients = new Map<string, { apiKey: string; client: Anthropic }>();

function resolveStage(stage: BrainLlmStage): ResolvedStage | { error: string } {
  const settings = brainSettingsManager.get();
  const stageConfig: BrainStageLlm = settings.llm[stage];
  const provider = settings.llm.providers.find((p) => p.id === stageConfig.providerId);
  if (!provider) return { error: `provedor "${stageConfig.providerId}" não existe nas settings` };
  const apiKey = process.env[provider.apiKeyEnv] ?? "";
  if (!apiKey) return { error: `${provider.apiKeyEnv} ausente no ambiente` };
  return { provider, model: stageConfig.model, apiKey };
}

export function stageDisabledReason(stage: BrainLlmStage): string | null {
  const resolved = resolveStage(stage);
  return "error" in resolved ? resolved.error : null;
}

export function stageSupportsBatch(stage: BrainLlmStage): boolean {
  const resolved = resolveStage(stage);
  return !("error" in resolved) && resolved.provider.features.batch;
}

export function stageClient(stage: BrainLlmStage): { client: Anthropic; model: string } | { error: string } {
  const resolved = resolveStage(stage);
  if ("error" in resolved) return resolved;
  return { client: getClient(resolved), model: resolved.model };
}

function getClient(resolved: ResolvedStage): Anthropic {
  const key = `${resolved.provider.baseUrl}|${resolved.provider.apiKeyEnv}`;
  const cached = clients.get(key);
  if (cached && cached.apiKey === resolved.apiKey) return cached.client;
  const client = new Anthropic({
    apiKey: resolved.apiKey,
    baseURL: resolved.provider.baseUrl || undefined,
    maxRetries: 2,
  });
  clients.set(key, { apiKey: resolved.apiKey, client });
  return client;
}

export function batchCustomId(key: string): string {
  return `k${sha256Hex(key).slice(0, 40)}`;
}

export interface StageRequest {
  system: { text: string; cacheable?: boolean }[];
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

const JSON_ONLY_INSTRUCTION =
  "Responda APENAS com um objeto JSON válido, sem markdown, sem texto antes ou depois, seguindo exatamente este JSON Schema:";

function buildParams(resolved: ResolvedStage, req: StageRequest): Anthropic.MessageCreateParamsNonStreaming {
  const useStructured = resolved.provider.features.structuredOutputs;
  const useCache = resolved.provider.features.caching;

  const system: Anthropic.TextBlockParam[] = req.system.map((block) => ({
    type: "text",
    text: block.text,
    ...(useCache && block.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  if (!useStructured) {
    system.push({
      type: "text",
      text: `${JSON_ONLY_INSTRUCTION}\n${JSON.stringify(req.schema)}`,
    });
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: resolved.model,
    max_tokens: req.maxTokens,
    system,
    messages: [{ role: "user", content: req.user }],
  };
  if (useStructured) {
    (params as unknown as Record<string, unknown>).output_config = {
      format: { type: "json_schema", schema: req.schema },
    };
  }
  return params;
}

export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("resposta do modelo não contém JSON");
}

function parseResponse(stage: BrainLlmStage, model: string, response: Anthropic.Message): unknown {
  void incrMetric(`tokens_in:${stage}`, response.usage.input_tokens);
  void incrMetric(`tokens_out:${stage}`, response.usage.output_tokens);
  if (response.stop_reason === "refusal") {
    throw new Error(`${model} recusou a requisição (stop_reason: refusal)`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`${model} truncou a resposta (max_tokens)`);
  }
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return extractJson(text);
}

export async function runStageJson(stage: BrainLlmStage, req: StageRequest): Promise<unknown> {
  const resolved = resolveStage(stage);
  if ("error" in resolved) throw new Error(resolved.error);
  const client = getClient(resolved);
  const response = await client.messages.create(buildParams(resolved, req));
  return parseResponse(stage, resolved.model, response);
}

export interface BatchRequestItem {
  customId: string;
  request: StageRequest;
}

export async function submitStageBatch(stage: BrainLlmStage, items: BatchRequestItem[]): Promise<string> {
  const resolved = resolveStage(stage);
  if ("error" in resolved) throw new Error(resolved.error);
  if (!resolved.provider.features.batch) throw new Error("provedor sem suporte a Batch API");
  const client = getClient(resolved);
  const batch = await client.messages.batches.create({
    requests: items.map((item) => ({
      custom_id: batchCustomId(item.customId),
      params: buildParams(resolved, item.request) as Anthropic.Messages.Batches.BatchCreateParams.Request["params"],
    })),
  });
  return batch.id;
}

export async function stageBatchStatus(
  stage: BrainLlmStage,
  batchId: string,
): Promise<{ status: string; processing: number; succeeded: number; errored: number }> {
  const resolved = resolveStage(stage);
  if ("error" in resolved) throw new Error(resolved.error);
  const batch = await getClient(resolved).messages.batches.retrieve(batchId);
  return {
    status: batch.processing_status,
    processing: batch.request_counts.processing,
    succeeded: batch.request_counts.succeeded,
    errored: batch.request_counts.errored,
  };
}

export async function collectStageBatch(
  stage: BrainLlmStage,
  batchId: string,
  customIds: string[],
): Promise<Map<string, { ok: true; value: unknown } | { ok: false; error: string }>> {
  const resolved = resolveStage(stage);
  if ("error" in resolved) throw new Error(resolved.error);
  const client = getClient(resolved);
  const byBatchId = new Map(customIds.map((id) => [batchCustomId(id), id]));
  const out = new Map<string, { ok: true; value: unknown } | { ok: false; error: string }>();
  for await (const result of await client.messages.batches.results(batchId)) {
    const customId = byBatchId.get(result.custom_id);
    if (!customId) continue;
    if (result.result.type === "succeeded") {
      try {
        out.set(customId, {
          ok: true,
          value: parseResponse(stage, resolved.model, result.result.message),
        });
      } catch (err) {
        out.set(customId, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      out.set(customId, { ok: false, error: result.result.type });
    }
  }
  return out;
}
