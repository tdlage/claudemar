import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
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
  if (Number.isNaN(parsed) || parsed < 0) {
    console.error(`${key} must be a non-negative number, got: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

const basePath = process.env.BASE_PATH || process.cwd();
const dataPath = resolve(basePath, "data");

export const config = Object.freeze({
  telegramBotToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  allowedChatId: Number(requiredEnv("ALLOWED_CHAT_ID")),
  basePath,
  dataPath,
  claudeTimeoutMs: numericEnv("CLAUDE_TIMEOUT_MS", 0),
  maxOutputLength: numericEnv("MAX_OUTPUT_LENGTH", 4096),
  maxBufferSize: numericEnv("MAX_BUFFER_SIZE", 10 * 1024 * 1024),
  orchestratorPath: resolve(basePath, "orchestrator"),
  projectsPath: resolve(basePath, "projects"),
  agentsPath: resolve(basePath, "agents"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  dashboardPort: numericEnv("DASHBOARD_PORT", 3000),
  dashboardToken: process.env.DASHBOARD_TOKEN || "",
  tokenRotationHours: numericEnv("TOKEN_ROTATION_HOURS", 24),
  dockerImage: process.env.DOCKER_IMAGE || "claudemar-devcontainer",
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || resolve(homedir(), ".claude"),
  sesFrom: process.env.AWS_SES_FROM || "",
  adminEmail: process.env.ADMIN_EMAIL || "",
  dockerAvailable: (() => {
    try {
      execFileSync("docker", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })(),
});

if (Number.isNaN(config.allowedChatId)) {
  console.error("ALLOWED_CHAT_ID must be a valid number");
  process.exit(1);
}

mkdirSync(config.dataPath, { recursive: true });
mkdirSync(config.orchestratorPath, { recursive: true });
mkdirSync(config.projectsPath, { recursive: true });
mkdirSync(config.agentsPath, { recursive: true });
mkdirSync(resolve(config.orchestratorPath, "outbox"), { recursive: true });
