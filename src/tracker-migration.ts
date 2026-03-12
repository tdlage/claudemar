import { randomUUID } from "node:crypto";
import { getPool } from "./database.js";

export interface CycleColumn {
  id: string;
  name: string;
  color: string;
  position: number;
}

const MIGRATION_FALLBACK_COLUMN_ID = "00000000-0000-4000-8000-000000000001";

export const DEFAULT_COLUMNS: CycleColumn[] = [
  { id: MIGRATION_FALLBACK_COLUMN_ID, name: "Pendente", color: "#6b7280", position: 0 },
  { id: "00000000-0000-4000-8000-000000000002", name: "Em andamento", color: "#3b82f6", position: 1 },
  { id: "00000000-0000-4000-8000-000000000003", name: "Em teste", color: "#f59e0b", position: 2 },
  { id: "00000000-0000-4000-8000-000000000004", name: "Em Correção", color: "#ef4444", position: 3 },
  { id: "00000000-0000-4000-8000-000000000005", name: "Finalizado", color: "#22c55e", position: 4 },
];

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS tracker_projects (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    description TEXT,
    next_bet_number INT NOT NULL DEFAULT 1,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (code)
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_cycles (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status ENUM('active','completed') NOT NULL DEFAULT 'active',
    columns JSON NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES tracker_projects(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_bets (
    id CHAR(36) PRIMARY KEY,
    cycle_id CHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    column_id CHAR(36) NOT NULL,
    appetite INT NOT NULL DEFAULT 7,
    priority VARCHAR(2) DEFAULT NULL,
    started_at DATETIME DEFAULT NULL,
    in_scope TEXT,
    out_of_scope TEXT,
    tags JSON,
    seq_number INT NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cycle_id) REFERENCES tracker_cycles(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_item_assignees (
    item_id CHAR(36) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (item_id, user_id),
    FOREIGN KEY (item_id) REFERENCES tracker_bets(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_comments (
    id CHAR(36) PRIMARY KEY,
    target_type ENUM('item') NOT NULL,
    target_id CHAR(36) NOT NULL,
    author_id VARCHAR(100) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_attachments (
    id CHAR(36) PRIMARY KEY,
    comment_id CHAR(36) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size INT UNSIGNED NOT NULL,
    uploaded_by VARCHAR(100) NOT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comment_id) REFERENCES tracker_comments(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_test_cases (
    id CHAR(36) PRIMARY KEY,
    target_type ENUM('item') NOT NULL,
    target_id CHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    preconditions TEXT,
    steps TEXT,
    expected_result TEXT,
    priority ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
    position INT NOT NULL DEFAULT 0,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_test_runs (
    id CHAR(36) PRIMARY KEY,
    test_case_id CHAR(36) NOT NULL,
    status ENUM('passed','failed','blocked','skipped') NOT NULL,
    notes TEXT,
    executed_by VARCHAR(100) NOT NULL,
    executed_by_name VARCHAR(255) NOT NULL,
    executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_seconds INT UNSIGNED,
    FOREIGN KEY (test_case_id) REFERENCES tracker_test_cases(id) ON DELETE CASCADE,
    INDEX idx_test_case (test_case_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_test_run_attachments (
    id CHAR(36) PRIMARY KEY,
    test_run_id CHAR(36) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    uploaded_by VARCHAR(100) NOT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (test_run_id) REFERENCES tracker_test_runs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_test_run_comments (
    id CHAR(36) PRIMARY KEY,
    test_run_id CHAR(36) NOT NULL,
    author_id VARCHAR(100) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (test_run_id) REFERENCES tracker_test_runs(id) ON DELETE CASCADE,
    INDEX idx_test_run (test_run_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_test_run_comment_attachments (
    id CHAR(36) PRIMARY KEY,
    comment_id CHAR(36) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    uploaded_by VARCHAR(100) NOT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comment_id) REFERENCES tracker_test_run_comments(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_item_plans (
    id CHAR(36) PRIMARY KEY,
    item_id CHAR(36) NOT NULL,
    target_project VARCHAR(255) NOT NULL,
    session_id VARCHAR(255) DEFAULT NULL,
    status ENUM('planning','planned','executing','reviewing','completed','error') NOT NULL DEFAULT 'planning',
    prompt_sent TEXT NOT NULL,
    plan_markdown LONGTEXT DEFAULT NULL,
    pending_questions JSON DEFAULT NULL,
    last_execution_id VARCHAR(36) DEFAULT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES tracker_bets(id) ON DELETE CASCADE,
    INDEX idx_item_plan (item_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const SCHEMA_UPGRADES: string[] = [
  `CREATE TABLE IF NOT EXISTS tracker_projects (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(10),
    description TEXT,
    next_bet_number INT NOT NULL DEFAULT 1,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

async function columnExists(pool: ReturnType<typeof getPool>, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return (rows as Array<{ cnt: number }>)[0].cnt > 0;
}

async function tableExists(pool: ReturnType<typeof getPool>, table: string): Promise<boolean> {
  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  return (rows as Array<{ cnt: number }>)[0].cnt > 0;
}

async function runSchemaUpgrades(): Promise<void> {
  const pool = getPool();

  for (const sql of SCHEMA_UPGRADES) {
    await pool.execute(sql);
  }

  if (!(await columnExists(pool, "tracker_cycles", "project_id"))) {
    await pool.execute("ALTER TABLE tracker_cycles ADD COLUMN project_id CHAR(36) AFTER id");
    const defaultProjectId = randomUUID();
    await pool.execute(
      "INSERT INTO tracker_projects (id, name, description, created_by) VALUES (?, 'Default', 'Auto-migrated project', 'system')",
      [defaultProjectId],
    );
    await pool.execute("UPDATE tracker_cycles SET project_id = ? WHERE project_id IS NULL", [defaultProjectId]);
    await pool.execute("ALTER TABLE tracker_cycles MODIFY COLUMN project_id CHAR(36) NOT NULL");
  }

  if (await columnExists(pool, "tracker_cycles", "start_date")) {
    await pool.execute("ALTER TABLE tracker_cycles DROP COLUMN start_date").catch(() => {});
    await pool.execute("ALTER TABLE tracker_cycles DROP COLUMN end_date").catch(() => {});
    await pool.execute("ALTER TABLE tracker_cycles DROP COLUMN cooldown_end_date").catch(() => {});
    await pool.execute("ALTER TABLE tracker_cycles MODIFY COLUMN status ENUM('active','completed') NOT NULL DEFAULT 'active'").catch(() => {});
  }

  if (await columnExists(pool, "tracker_bets", "project_name")) {
    await pool.execute("ALTER TABLE tracker_bets DROP COLUMN project_name").catch(() => {});
  }

  if (!(await columnExists(pool, "tracker_cycles", "columns"))) {
    const defaultJson = JSON.stringify(DEFAULT_COLUMNS);
    await pool.execute("ALTER TABLE tracker_cycles ADD COLUMN columns JSON");
    await pool.execute("UPDATE tracker_cycles SET columns = ? WHERE columns IS NULL", [defaultJson]);
    await pool.execute("ALTER TABLE tracker_cycles MODIFY COLUMN columns JSON NOT NULL");
  }

  if (!(await columnExists(pool, "tracker_bets", "in_scope"))) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN in_scope TEXT");
  }
  if (!(await columnExists(pool, "tracker_bets", "out_of_scope"))) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN out_of_scope TEXT");
  }

  if ((await columnExists(pool, "tracker_bets", "status")) && !(await columnExists(pool, "tracker_bets", "column_id"))) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN column_id CHAR(36)");
    await pool.execute(`
      UPDATE tracker_bets b
      JOIN tracker_cycles c ON b.cycle_id = c.id
      SET b.column_id = JSON_UNQUOTE(JSON_EXTRACT(c.columns, '$[0].id'))
    `).catch(() => {
      const fallbackId = DEFAULT_COLUMNS[0].id;
      return pool.execute("UPDATE tracker_bets SET column_id = ? WHERE column_id IS NULL", [fallbackId]);
    });
    await pool.execute("UPDATE tracker_bets SET column_id = ? WHERE column_id IS NULL", [DEFAULT_COLUMNS[0].id]);
    await pool.execute("ALTER TABLE tracker_bets MODIFY COLUMN column_id CHAR(36) NOT NULL");
    await pool.execute("ALTER TABLE tracker_bets DROP COLUMN status").catch(() => {});
  }

  await pool.execute("DROP TABLE IF EXISTS tracker_commit_links").catch(() => {});
  await pool.execute("DROP TABLE IF EXISTS tracker_scope_assignees").catch(() => {});
  await pool.execute("DROP TABLE IF EXISTS tracker_scopes").catch(() => {});

  if (await tableExists(pool, "tracker_comments")) {
    await pool.execute("ALTER TABLE tracker_comments MODIFY COLUMN target_type ENUM('bet','item') NOT NULL").catch(() => {});
    await pool.execute("UPDATE tracker_comments SET target_type = 'item' WHERE target_type = 'bet'").catch(() => {});
  }
  if (await tableExists(pool, "tracker_test_cases")) {
    await pool.execute("ALTER TABLE tracker_test_cases MODIFY COLUMN target_type ENUM('bet','item') NOT NULL").catch(() => {});
    await pool.execute("UPDATE tracker_test_cases SET target_type = 'item' WHERE target_type = 'bet'").catch(() => {});
  }

  if (!(await columnExists(pool, "tracker_projects", "code"))) {
    await pool.execute("ALTER TABLE tracker_projects ADD COLUMN code VARCHAR(10) AFTER name");
    await pool.execute("ALTER TABLE tracker_projects ADD COLUMN next_bet_number INT NOT NULL DEFAULT 1 AFTER description");
    const [projects] = await pool.execute("SELECT id, name FROM tracker_projects");
    const usedCodes = new Set<string>();
    for (const p of projects as Array<{ id: string; name: string }>) {
      let code = p.name.replace(/[^A-Za-z0-9]/g, "").substring(0, 4).toUpperCase();
      if (!code) code = "PROJ";
      let finalCode = code;
      let suffix = 1;
      while (usedCodes.has(finalCode)) {
        finalCode = `${code}${suffix}`;
        suffix++;
      }
      usedCodes.add(finalCode);
      await pool.execute("UPDATE tracker_projects SET code = ? WHERE id = ?", [finalCode, p.id]);
    }
    await pool.execute("ALTER TABLE tracker_projects MODIFY COLUMN code VARCHAR(10) NOT NULL");
    await pool.execute("ALTER TABLE tracker_projects ADD UNIQUE KEY uk_code (code)").catch(() => {});
  }

  const [colTypeRows] = await pool.execute(
    "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracker_bets' AND COLUMN_NAME = 'appetite'",
  );
  const colType = (colTypeRows as Array<{ COLUMN_TYPE: string }>)[0]?.COLUMN_TYPE ?? "";
  if (colType.toLowerCase().includes("enum")) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN appetite_int INT NOT NULL DEFAULT 7");
    await pool.execute("UPDATE tracker_bets SET appetite_int = CASE WHEN appetite = 'big' THEN 14 ELSE 3 END");
    await pool.execute("ALTER TABLE tracker_bets DROP COLUMN appetite");
    await pool.execute("ALTER TABLE tracker_bets CHANGE appetite_int appetite INT NOT NULL DEFAULT 7");
  }

  if (!(await columnExists(pool, "tracker_bets", "seq_number"))) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN seq_number INT NOT NULL DEFAULT 0 AFTER tags");
    const [projects] = await pool.execute("SELECT id FROM tracker_projects");
    for (const p of projects as Array<{ id: string }>) {
      const [bets] = await pool.execute(
        "SELECT b.id FROM tracker_bets b JOIN tracker_cycles c ON b.cycle_id = c.id WHERE c.project_id = ? ORDER BY b.created_at",
        [p.id],
      );
      let seq = 1;
      for (const b of bets as Array<{ id: string }>) {
        await pool.execute("UPDATE tracker_bets SET seq_number = ? WHERE id = ?", [seq, b.id]);
        seq++;
      }
      await pool.execute("UPDATE tracker_projects SET next_bet_number = ? WHERE id = ?", [seq, p.id]);
    }
  }

  if (!(await columnExists(pool, "tracker_bets", "started_at"))) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN started_at DATETIME DEFAULT NULL AFTER seq_number");
  }

  if (!(await columnExists(pool, "tracker_bets", "priority"))) {
    await pool.execute("ALTER TABLE tracker_bets ADD COLUMN priority VARCHAR(2) DEFAULT NULL AFTER appetite");
  }

  if (await tableExists(pool, "tracker_bet_assignees")) {
    await pool.execute("RENAME TABLE tracker_bet_assignees TO tracker_item_assignees");
  }
  if (await tableExists(pool, "tracker_item_assignees") && await columnExists(pool, "tracker_item_assignees", "bet_id")) {
    await pool.execute("ALTER TABLE tracker_item_assignees CHANGE bet_id item_id CHAR(36) NOT NULL");
  }
}

export async function runTrackerMigrations(): Promise<void> {
  const pool = getPool();
  for (const sql of MIGRATIONS) {
    await pool.execute(sql);
  }
  await runSchemaUpgrades();
  console.log("[tracker] Database migrations completed");
}
