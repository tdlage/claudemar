import "dotenv/config";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

function numericEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) {
    console.error(`${key} must be a non-negative number, got: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

function stringEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw && raw.length > 0 ? raw : fallback;
}

function booleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

const installDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const basePath = process.env.CLAUDEMAR_DATA || process.env.BASE_PATH || resolve(homedir(), ".claudemar");
const dataPath = resolve(basePath, "data");

export const config = Object.freeze({
  telegramBotToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  allowedChatId: Number(requiredEnv("ALLOWED_CHAT_ID")),
  installDir,
  basePath,
  dataPath,
  agentTimeoutMs: numericEnv("AGENT_TIMEOUT_MS", numericEnv("CLAUDE_TIMEOUT_MS", 0)),
  permissionTimeoutMs: numericEnv("PERMISSION_TIMEOUT_MS", 10 * 60 * 1000),
  maxOutputLength: numericEnv("MAX_OUTPUT_LENGTH", 4096),
  maxBufferSize: numericEnv("MAX_BUFFER_SIZE", 10 * 1024 * 1024),
  orchestratorPath: resolve(basePath, "orchestrator"),
  projectsPath: resolve(basePath, "projects"),
  agentsPath: resolve(basePath, "agents"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  gatewayUrl: stringEnv("GATEWAY_URL", "http://localhost:8080/anthropic"),
  dashboardPort: numericEnv("DASHBOARD_PORT", 3000),
  publicBaseUrl: stringEnv("PUBLIC_BASE_URL", ""),
  dashboardToken: process.env.DASHBOARD_TOKEN || "",
  tokenRotationHours: numericEnv("TOKEN_ROTATION_HOURS", 24),
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || resolve(homedir(), ".claude"),
  qdrantUrl: stringEnv("QDRANT_URL", ""),
  qdrantApiKey: stringEnv("QDRANT_API_KEY", ""),
  qdrantCollection: stringEnv("QDRANT_COLLECTION", "claudemar_sessions"),
  voyageApiKey: stringEnv("VOYAGE_API_KEY", ""),
  embeddingModel: stringEnv("EMBEDDING_MODEL", "voyage-4-large"),
  embeddingDim: numericEnv("EMBEDDING_DIM", 1024),
  rerankModel: stringEnv("RERANK_MODEL", "rerank-2.5"),
  memoryDomainInstruction: stringEnv("MEMORY_DOMAIN_INSTRUCTION", ""),
  retrieveCandidates: numericEnv("RETRIEVE_CANDIDATES", 40),
  rerankTopK: numericEnv("RERANK_TOP_K", 8),
  hybridBm25: booleanEnv("HYBRID_BM25", true),
  memoryReconcile: booleanEnv("MEMORY_RECONCILE", false),
  sesFrom: process.env.AWS_SES_FROM || "",
  adminEmail: process.env.ADMIN_EMAIL || "",
  mysqlHost: process.env.MYSQL_HOST || "localhost",
  mysqlPort: numericEnv("MYSQL_PORT", 3306),
  mysqlUser: process.env.MYSQL_USER || "claudemar",
  mysqlPassword: process.env.MYSQL_PASSWORD || "",
  mysqlDatabase: process.env.MYSQL_DATABASE || "claudemar",
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
  maxParallelPipelineRuns: numericEnv("MAX_PARALLEL_PIPELINE_RUNS", 3),
  pipelineStageTimeoutMs: numericEnv("PIPELINE_STAGE_TIMEOUT_MS", 120 * 60 * 1000),
  maxPipelineRetries: numericEnv("MAX_PIPELINE_RETRIES", 3),
  pipelineBotLogin: stringEnv("PIPELINE_BOT_LOGIN", ""),
  pipelineReworkKeyword: stringEnv("PIPELINE_REWORK_KEYWORD", ""),
});

if (Number.isNaN(config.allowedChatId)) {
  console.error("ALLOWED_CHAT_ID must be a valid number");
  process.exit(1);
}

mkdirSync(config.dataPath, { recursive: true });
mkdirSync(config.orchestratorPath, { recursive: true });
mkdirSync(config.projectsPath, { recursive: true });
mkdirSync(config.agentsPath, { recursive: true });
mkdirSync(resolve(config.dataPath, "pipeline-worktrees"), { recursive: true });
