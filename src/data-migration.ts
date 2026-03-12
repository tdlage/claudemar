import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "./database.js";
import { config } from "./config.js";

const TABLE_DEFINITIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_token (token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS user_projects (
    user_id CHAR(36) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    PRIMARY KEY (user_id, project_name),
    INDEX idx_project (project_name),
    CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS user_agents (
    user_id CHAR(36) NOT NULL,
    agent_name VARCHAR(255) NOT NULL,
    PRIMARY KEY (user_id, agent_name),
    INDEX idx_agent (agent_name),
    CONSTRAINT fk_ua_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS user_tracker_projects (
    user_id CHAR(36) NOT NULL,
    tracker_project_id VARCHAR(255) NOT NULL,
    PRIMARY KEY (user_id, tracker_project_id),
    INDEX idx_tracker_project (tracker_project_id),
    CONSTRAINT fk_utp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS run_configs (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    command TEXT NOT NULL,
    working_directory TEXT NOT NULL,
    env_vars JSON NOT NULL DEFAULT ('{}'),
    project_name VARCHAR(255) NOT NULL,
    proxy_domain VARCHAR(255) DEFAULT NULL,
    proxy_port INT UNSIGNED DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS queue_items (
    seq_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id CHAR(36) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_name VARCHAR(255) NOT NULL,
    prompt LONGTEXT NOT NULL,
    source VARCHAR(50) NOT NULL,
    cwd TEXT NOT NULL,
    resume_session_id VARCHAR(255) DEFAULT NULL,
    model VARCHAR(100) DEFAULT NULL,
    plan_mode TINYINT(1) NOT NULL DEFAULT 0,
    agent_name VARCHAR(255) DEFAULT NULL,
    username VARCHAR(255) DEFAULT NULL,
    use_docker TINYINT(1) NOT NULL DEFAULT 0,
    enqueued_at DATETIME NOT NULL,
    telegram_chat_id BIGINT DEFAULT NULL,
    UNIQUE KEY uk_id (id),
    INDEX idx_target (target_type, target_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS telegram_sessions (
    chat_id BIGINT PRIMARY KEY,
    active_project VARCHAR(255) DEFAULT NULL,
    session_ids JSON NOT NULL DEFAULT ('{}'),
    mode ENUM('projects', 'agents') NOT NULL DEFAULT 'projects',
    active_agent VARCHAR(255) DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS session_names (
    session_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS session_name_counters (
    label VARCHAR(100) PRIMARY KEY,
    counter INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS schedules (
    id VARCHAR(36) PRIMARY KEY,
    agent VARCHAR(255) NOT NULL,
    cron VARCHAR(100) NOT NULL,
    cron_human TEXT NOT NULL,
    task TEXT NOT NULL,
    script_path TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_agent (agent)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS execution_history (
    id CHAR(36) PRIMARY KEY,
    prompt LONGTEXT NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_name VARCHAR(255) NOT NULL,
    agent_name VARCHAR(255) DEFAULT NULL,
    status VARCHAR(50) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) DEFAULT NULL,
    cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
    duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    source VARCHAR(50) NOT NULL,
    output LONGTEXT DEFAULT NULL,
    error TEXT DEFAULT NULL,
    session_id VARCHAR(255) DEFAULT NULL,
    plan_mode TINYINT(1) NOT NULL DEFAULT 0,
    username VARCHAR(255) DEFAULT NULL,
    INDEX idx_target (target_type, target_name),
    INDEX idx_started_at (started_at),
    INDEX idx_target_started (target_type, target_name, started_at),
    INDEX idx_session_lookup (target_type, target_name, username, status, started_at),
    INDEX idx_agent_metrics (target_type, agent_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS agent_secrets (
    id CHAR(36) PRIMARY KEY,
    agent_name VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    description TEXT NOT NULL,
    INDEX idx_agent (agent_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS agent_secret_file_descriptions (
    agent_name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    PRIMARY KEY (agent_name, filename)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

interface HistoryEntry {
  id: string;
  prompt: string;
  targetType: string;
  targetName: string;
  agentName?: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  costUsd: number;
  durationMs: number;
  source: string;
  output?: string;
  error?: string | null;
  sessionId?: string;
  planMode?: boolean;
  username?: string;
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function toMysqlDatetime(val: string | null | undefined): string | null {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function backupFile(path: string): void {
  if (existsSync(path)) {
    renameSync(path, path + ".bak");
  }
}

async function tableIsEmpty(pool: ReturnType<typeof getPool>, table: string): Promise<boolean> {
  const [rows] = await pool.execute(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return (rows as Array<{ cnt: number }>)[0].cnt === 0;
}

async function migrateUsers(pool: ReturnType<typeof getPool>): Promise<void> {
  const filePath = resolve(config.dataPath, "users.json");
  const data = readJsonFile(filePath) as Array<{
    id: string; name: string; email: string; token: string;
    projects?: string[]; agents?: string[]; trackerProjects?: string[];
    createdAt: string;
  }> | null;
  if (!data || !(await tableIsEmpty(pool, "users"))) {
    if (data) backupFile(filePath);
    return;
  }

  for (const u of data) {
    await pool.execute(
      "INSERT INTO users (id, name, email, token, created_at) VALUES (?, ?, ?, ?, ?)",
      [u.id, u.name, u.email, u.token || "", toMysqlDatetime(u.createdAt)],
    );
    for (const p of u.projects ?? []) {
      await pool.execute("INSERT INTO user_projects (user_id, project_name) VALUES (?, ?)", [u.id, p]);
    }
    for (const a of u.agents ?? []) {
      await pool.execute("INSERT INTO user_agents (user_id, agent_name) VALUES (?, ?)", [u.id, a]);
    }
    for (const tp of u.trackerProjects ?? []) {
      await pool.execute("INSERT INTO user_tracker_projects (user_id, tracker_project_id) VALUES (?, ?)", [u.id, tp]);
    }
  }
  console.log(`[data-migration] Migrated ${data.length} users`);
  backupFile(filePath);
}

async function migrateRunConfigs(pool: ReturnType<typeof getPool>): Promise<void> {
  const filePath = resolve(config.dataPath, "run-configs.json");
  const data = readJsonFile(filePath) as Array<{
    id: string; name: string; command: string; workingDirectory: string;
    envVars: Record<string, string>; projectName: string;
    proxyDomain?: string; proxyPort?: number;
  }> | null;
  if (!data || !(await tableIsEmpty(pool, "run_configs"))) {
    if (data) backupFile(filePath);
    return;
  }

  for (const c of data) {
    await pool.execute(
      "INSERT INTO run_configs (id, name, command, working_directory, env_vars, project_name, proxy_domain, proxy_port) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [c.id, c.name, c.command, c.workingDirectory, JSON.stringify(c.envVars || {}), c.projectName, c.proxyDomain ?? null, c.proxyPort ?? null],
    );
  }
  console.log(`[data-migration] Migrated ${data.length} run configs`);
  backupFile(filePath);
}

async function migrateQueue(pool: ReturnType<typeof getPool>): Promise<void> {
  const filePath = resolve(config.dataPath, "queue.json");
  const data = readJsonFile(filePath) as { nextSeqId?: number; items?: Array<{
    id: string; seqId: number; targetType: string; targetName: string;
    prompt: string; source: string; cwd: string; resumeSessionId?: string;
    model?: string; planMode?: boolean; agentName?: string; username?: string;
    useDocker?: boolean; enqueuedAt: string; telegramChatId?: number;
  }> } | null;
  if (!data || !(await tableIsEmpty(pool, "queue_items"))) {
    if (data) backupFile(filePath);
    return;
  }

  const items = data.items ?? [];
  let maxSeqId = 0;
  for (const item of items) {
    await pool.execute(
      `INSERT INTO queue_items (seq_id, id, target_type, target_name, prompt, source, cwd, resume_session_id, model, plan_mode, agent_name, username, use_docker, enqueued_at, telegram_chat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.seqId, item.id, item.targetType, item.targetName, item.prompt, item.source, item.cwd,
       item.resumeSessionId ?? null, item.model ?? null, item.planMode ? 1 : 0,
       item.agentName ?? null, item.username ?? null, item.useDocker ? 1 : 0,
       toMysqlDatetime(item.enqueuedAt), item.telegramChatId ?? null],
    );
    if (item.seqId > maxSeqId) maxSeqId = item.seqId;
  }

  const nextSeqId = Math.max(maxSeqId + 1, data.nextSeqId ?? 1);
  await pool.execute(`ALTER TABLE queue_items AUTO_INCREMENT = ${nextSeqId}`);

  console.log(`[data-migration] Migrated ${items.length} queue items (AUTO_INCREMENT=${nextSeqId})`);
  backupFile(filePath);
}

async function migrateTelegramSessions(pool: ReturnType<typeof getPool>): Promise<void> {
  const filePath = resolve(config.dataPath, "sessions.json");
  const data = readJsonFile(filePath) as Record<string, {
    activeProject: string | null; sessionIds: Record<string, string>;
    mode: string; activeAgent: string | null;
  }> | null;
  if (!data || !(await tableIsEmpty(pool, "telegram_sessions"))) {
    if (data) backupFile(filePath);
    return;
  }

  let count = 0;
  for (const [chatIdStr, session] of Object.entries(data)) {
    const chatId = Number(chatIdStr);
    if (Number.isNaN(chatId)) continue;
    await pool.execute(
      "INSERT INTO telegram_sessions (chat_id, active_project, session_ids, mode, active_agent) VALUES (?, ?, ?, ?, ?)",
      [chatId, session.activeProject ?? null, JSON.stringify(session.sessionIds ?? {}),
       session.mode || "projects", session.activeAgent ?? null],
    );
    count++;
  }
  console.log(`[data-migration] Migrated ${count} telegram sessions`);
  backupFile(filePath);
}

async function migrateSessionNames(pool: ReturnType<typeof getPool>): Promise<void> {
  const filePath = resolve(config.dataPath, "session-names.json");
  const data = readJsonFile(filePath) as {
    nextNumber?: number;
    userCounters?: Record<string, number>;
    names?: Record<string, string>;
  } | null;
  if (!data || !(await tableIsEmpty(pool, "session_names"))) {
    if (data) backupFile(filePath);
    return;
  }

  let nameCount = 0;
  for (const [sessionId, name] of Object.entries(data.names ?? {})) {
    await pool.execute("INSERT INTO session_names (session_id, name) VALUES (?, ?)", [sessionId, name]);
    nameCount++;
  }

  for (const [label, counter] of Object.entries(data.userCounters ?? {})) {
    await pool.execute("INSERT INTO session_name_counters (label, counter) VALUES (?, ?)", [label, counter]);
  }

  console.log(`[data-migration] Migrated ${nameCount} session names`);
  backupFile(filePath);
}

async function migrateSchedules(pool: ReturnType<typeof getPool>): Promise<void> {
  const filePath = resolve(config.dataPath, "schedules.json");
  const data = readJsonFile(filePath) as Array<{
    id: string; agent: string; cron: string; cronHuman: string;
    task: string; scriptPath: string; createdAt: string;
  }> | null;
  if (!data || !(await tableIsEmpty(pool, "schedules"))) {
    if (data) backupFile(filePath);
    return;
  }

  for (const s of data) {
    await pool.execute(
      "INSERT INTO schedules (id, agent, cron, cron_human, task, script_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [s.id, s.agent, s.cron, s.cronHuman, s.task, s.scriptPath, toMysqlDatetime(s.createdAt)],
    );
  }
  console.log(`[data-migration] Migrated ${data.length} schedules`);
  backupFile(filePath);
}

async function migrateHistory(pool: ReturnType<typeof getPool>): Promise<void> {
  if (!(await tableIsEmpty(pool, "execution_history"))) return;

  const allEntries: HistoryEntry[] = [];

  const oldHistoryPath = resolve(config.dataPath, "history.jsonl");
  if (existsSync(oldHistoryPath)) {
    const content = readFileSync(oldHistoryPath, "utf-8");
    for (const line of content.trimEnd().split("\n").filter(Boolean)) {
      try { allEntries.push(JSON.parse(line)); } catch { }
    }
    backupFile(oldHistoryPath);
  }

  const historyDir = resolve(config.dataPath, "history");
  if (existsSync(historyDir)) {
    const files = readdirSync(historyDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = resolve(historyDir, file);
      const content = readFileSync(filePath, "utf-8");
      for (const line of content.trimEnd().split("\n").filter(Boolean)) {
        try { allEntries.push(JSON.parse(line)); } catch { }
      }
      backupFile(filePath);
    }
  }

  if (allEntries.length === 0) return;

  const seen = new Set<string>();
  const unique = allEntries.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const BATCH_SIZE = 100;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values: (string | number | null)[] = [];
    for (const e of batch) {
      values.push(
        e.id, e.prompt, e.targetType, e.targetName,
        e.agentName ?? null, e.status, toMysqlDatetime(e.startedAt), toMysqlDatetime(e.completedAt),
        e.costUsd ?? 0, e.durationMs ?? 0, e.source ?? "telegram",
        e.output ?? null, e.error ?? null, e.sessionId ?? null,
        e.planMode ? 1 : 0, e.username ?? null,
      );
    }
    await pool.execute(
      `INSERT INTO execution_history (id, prompt, target_type, target_name, agent_name, status, started_at, completed_at, cost_usd, duration_ms, source, output, error, session_id, plan_mode, username) VALUES ${placeholders}`,
      values,
    );
  }
  console.log(`[data-migration] Migrated ${unique.length} history entries`);
}

async function migrateSecrets(pool: ReturnType<typeof getPool>): Promise<void> {
  if (!(await tableIsEmpty(pool, "agent_secrets"))) return;
  if (!existsSync(config.agentsPath)) return;

  let secretCount = 0;
  let fileDescCount = 0;

  for (const dir of readdirSync(config.agentsPath, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const agentName = dir.name;

    const secretsFile = resolve(config.agentsPath, agentName, "secrets.json");
    if (existsSync(secretsFile)) {
      try {
        const raw = JSON.parse(readFileSync(secretsFile, "utf-8"));
        const secrets: Array<{ id: string; name: string; value: string; description: string }> =
          Array.isArray(raw) ? raw : (raw.secrets ?? []);

        for (const s of secrets) {
          await pool.execute(
            "INSERT INTO agent_secrets (id, agent_name, name, value, description) VALUES (?, ?, ?, ?, ?)",
            [s.id, agentName, s.name, s.value, s.description || ""],
          );
          secretCount++;
        }
        backupFile(secretsFile);
      } catch { }
    }

    const fileDescPath = resolve(config.agentsPath, agentName, "secrets", "file-descriptions.json");
    if (existsSync(fileDescPath)) {
      try {
        const descriptions: Record<string, string> = JSON.parse(readFileSync(fileDescPath, "utf-8"));
        for (const [filename, description] of Object.entries(descriptions)) {
          await pool.execute(
            "INSERT INTO agent_secret_file_descriptions (agent_name, filename, description) VALUES (?, ?, ?)",
            [agentName, filename, description],
          );
          fileDescCount++;
        }
        backupFile(fileDescPath);
      } catch { }
    }
  }

  if (secretCount > 0 || fileDescCount > 0) {
    console.log(`[data-migration] Migrated ${secretCount} secrets, ${fileDescCount} file descriptions`);
  }
}

async function migrateLastSessions(): Promise<void> {
  const filePath = resolve(config.dataPath, "last-sessions.json");
  if (existsSync(filePath)) {
    backupFile(filePath);
    console.log("[data-migration] Backed up last-sessions.json (data derived from execution_history)");
  }
}

async function migrateMetrics(): Promise<void> {
  const filePath = resolve(config.dataPath, "metrics.json");
  if (existsSync(filePath)) {
    backupFile(filePath);
    console.log("[data-migration] Backed up metrics.json (data derived from execution_history)");
  }
}

export async function runDataMigrations(): Promise<void> {
  const pool = getPool();

  for (const sql of TABLE_DEFINITIONS) {
    await pool.execute(sql);
  }

  await migrateUsers(pool);
  await migrateRunConfigs(pool);
  await migrateQueue(pool);
  await migrateTelegramSessions(pool);
  await migrateSessionNames(pool);
  await migrateSchedules(pool);
  await migrateHistory(pool);
  await migrateSecrets(pool);
  await migrateLastSessions();
  await migrateMetrics();

  console.log("[data-migration] All data migrations completed");
}
