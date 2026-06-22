export type LlmProvider = "anthropic" | "zai";

export const LLM_PROVIDERS: LlmProvider[] = ["anthropic", "zai"];

// Modelo padrão usado quando o provedor é z.ai. "glm-5.2[1m]" ativa o GLM-5.2 com
// contexto de 1M (exige CLAUDE_CODE_AUTO_COMPACT_WINDOW). Campo vazio = padrão do
// servidor da z.ai (hoje GLM-4.7), que auto-atualiza para o GLM mais recente.
export const DEFAULT_ZAI_MODEL = "glm-5.2[1m]";

const ZAI_BASE_URL = "https://api.z.ai/api/anthropic";
const ZAI_TIMEOUT_MS = "3000000";
const ZAI_HAIKU_MODEL = "glm-4.7";
const ZAI_1M_COMPACT_WINDOW = "1000000";

export function applyProvider(
  baseEnv: NodeJS.ProcessEnv,
  provider: LlmProvider,
  zaiModel: string,
  zaiToken: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  // Sem token a z.ai não é acionável: mantém o provedor Anthropic em vez de apontar
  // o base URL para a z.ai sem credencial (o que quebraria todas as execuções).
  if (provider !== "zai" || !zaiToken) return env;

  env.ANTHROPIC_BASE_URL = ZAI_BASE_URL;
  env.API_TIMEOUT_MS = ZAI_TIMEOUT_MS;
  env.ANTHROPIC_AUTH_TOKEN = zaiToken;
  delete env.ANTHROPIC_API_KEY;

  const model = zaiModel.trim();
  if (!model) return env;

  env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = ZAI_HAIKU_MODEL;
  if (model.includes("[1m]")) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = ZAI_1M_COMPACT_WINDOW;

  return env;
}
