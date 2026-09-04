import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const ENV_PATH = resolve(config.installDir, ".env");

export interface ManagedEnvKey {
  key: string;
  label: string;
  group: string;
  help: string;
  required: boolean;
}

const LLM_GROUP = "Provedores LLM";
const WHISPER_GROUP = "Transcrição de voz (Whisper)";
const BRAIN_GROUP = "Second Brain";

export const MANAGED_ENV_KEYS: ManagedEnvKey[] = [
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", group: WHISPER_GROUP, help: "Usada apenas pelo Whisper na transcrição de voz. Os modelos GPT rodam pela assinatura do ChatGPT (login do Codex em Configurações), nunca por esta chave.", required: false },
  { key: "ZAI_API_KEY", label: "z.ai API Key", group: LLM_GROUP, help: "Token da z.ai (GLM Coding Plan) para o perfil z.ai. Conexão direta ao endpoint de coding (api.z.ai/api/anthropic, compatível com a API da Anthropic).", required: false },
  { key: "KIMI_API_KEY", label: "Kimi API Key", group: LLM_GROUP, help: "Chave do Kimi Code (endpoint api.kimi.com/coding, compatível com a API da Anthropic) para o perfil kimi. Obtenha no console em https://www.kimi.com/code (Create API Key). Não confundir com a chave da plataforma Moonshot.", required: false },
  { key: "VOYAGE_API_KEY", label: "Voyage API Key", group: "Memória de longo prazo", help: "Embeddings (voyage-4-large) e rerank (rerank-2.5). Necessária para a memória.", required: false },
  { key: "QDRANT_URL", label: "Qdrant URL", group: "Memória de longo prazo", help: "Endpoint do cluster Qdrant (ex.: https://xxxx.cloud.qdrant.io).", required: false },
  { key: "QDRANT_API_KEY", label: "Qdrant API Key", group: "Memória de longo prazo", help: "Chave de acesso do Qdrant Cloud.", required: false },
  { key: "BRAIN_ANTHROPIC_API_KEY", label: "Anthropic API Key (brain)", group: BRAIN_GROUP, help: "Chave da Anthropic dedicada ao pipeline do Second Brain (triagem/compilação). Separada de ANTHROPIC_API_KEY para não substituir a subscription do Claude.", required: false },
  { key: "GOOGLE_CLIENT_ID", label: "Google Client ID", group: BRAIN_GROUP, help: "OAuth client do Google Cloud para os conectores Gmail/Calendar. Redirect URI: <PUBLIC_BASE_URL>/api/brain/google/callback.", required: false },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google Client Secret", group: BRAIN_GROUP, help: "Secret do OAuth client do Google Cloud.", required: false },
  { key: "REDIS_URL", label: "Redis URL", group: BRAIN_GROUP, help: "Endpoint do Redis usado pelo brain (cursores, filas, dedup). Padrão: redis://127.0.0.1:6379.", required: false },
  { key: "R2_ENDPOINT", label: "R2 Endpoint", group: BRAIN_GROUP, help: "Endpoint S3 do Cloudflare R2 para anexos e originais. Vazio = armazenamento local em BRAIN_ROOT/attachments.", required: false },
  { key: "R2_ACCESS_KEY_ID", label: "R2 Access Key ID", group: BRAIN_GROUP, help: "Credencial de acesso do bucket R2.", required: false },
  { key: "R2_SECRET_ACCESS_KEY", label: "R2 Secret Access Key", group: BRAIN_GROUP, help: "Credencial secreta do bucket R2.", required: false },
  { key: "R2_BUCKET_ATTACHMENTS", label: "R2 Bucket (anexos)", group: BRAIN_GROUP, help: "Nome do bucket R2 para anexos do brain.", required: false },
  { key: "WHATSAPP_BRIDGE_URL", label: "WhatsApp Bridge URL", group: BRAIN_GROUP, help: "Endpoint do bridge GOWA (container claudemar-whatsapp). Padrão: http://127.0.0.1:3010.", required: false },
  { key: "WHATSAPP_BRIDGE_AUTH", label: "WhatsApp Bridge Auth", group: BRAIN_GROUP, help: "Basic auth do bridge no formato usuario:senha (APP_BASIC_AUTH do container).", required: false },
  { key: "WHATSAPP_BRIDGE_WEBHOOK", label: "WhatsApp Bridge Webhook", group: BRAIN_GROUP, help: "URL que o container do bridge chama ao receber mensagem. Padrão: http://host.docker.internal:<porta>/api/brain/whatsapp/webhook.", required: false },
  { key: "BRAIN_WHATSAPP_WEBHOOK_SECRET", label: "WhatsApp Webhook Secret", group: BRAIN_GROUP, help: "Segredo HMAC compartilhado com o bridge para validar webhooks de mensagem.", required: false },
  { key: "SLACK_APP_TOKEN", label: "Slack App Token", group: BRAIN_GROUP, help: "Token xapp- (Socket Mode) do app Slack do brain.", required: false },
  { key: "SLACK_BOT_TOKEN", label: "Slack Bot Token", group: BRAIN_GROUP, help: "Token xoxb- do bot Slack (Web API). O bot precisa ser convidado nos canais a ingerir.", required: false },
];

export interface EnvKeyStatus extends ManagedEnvKey {
  present: boolean;
}

export function getEnvStatus(): EnvKeyStatus[] {
  return MANAGED_ENV_KEYS.map((k) => ({ ...k, present: Boolean(process.env[k.key]) }));
}

function escapeEnvValue(value: string): string {
  if (/[\s"'#=]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function matchesKey(line: string, key: string): boolean {
  return line.replace(/^\s*export\s+/, "").startsWith(`${key}=`);
}

export function updateEnv(values: Record<string, string>): string[] {
  const allowed = new Set(MANAGED_ENV_KEYS.map((k) => k.key));
  const updated: string[] = [];

  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8").split("\n") : [];

  for (const [key, raw] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    const value = String(raw ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim();
    if (!value) continue;

    const line = `${key}=${escapeEnvValue(value)}`;
    const idx = lines.findIndex((l) => matchesKey(l, key));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);

    process.env[key] = value;
    updated.push(key);
  }

  if (updated.length === 0) return [];

  let content = lines.join("\n");
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(ENV_PATH, content, { encoding: "utf-8", mode: 0o600 });
  chmodSync(ENV_PATH, 0o600);

  return updated;
}
