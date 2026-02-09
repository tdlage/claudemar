import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.error(`${key} must be a positive number, got: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

const basePath = process.env.BASE_PATH || process.cwd();

export const config = Object.freeze({
  telegramBotToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  allowedChatId: Number(requiredEnv("ALLOWED_CHAT_ID")),
  basePath,
  claudeTimeoutMs: numericEnv("CLAUDE_TIMEOUT_MS", 300_000),
  maxOutputLength: numericEnv("MAX_OUTPUT_LENGTH", 4096),
  maxBufferSize: numericEnv("MAX_BUFFER_SIZE", 10 * 1024 * 1024),
  orchestratorPath: resolve(basePath, "orchestrator"),
  projectsPath: resolve(basePath, "projects"),
});

if (Number.isNaN(config.allowedChatId)) {
  console.error("ALLOWED_CHAT_ID must be a valid number");
  process.exit(1);
}

mkdirSync(config.orchestratorPath, { recursive: true });
mkdirSync(config.projectsPath, { recursive: true });
