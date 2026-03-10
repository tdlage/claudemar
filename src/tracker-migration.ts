import { getPool } from "./database.js";

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS tracker_cycles (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status ENUM('shaping','betting','building','cooldown','completed') NOT NULL DEFAULT 'shaping',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    cooldown_end_date DATE NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_bets (
    id CHAR(36) PRIMARY KEY,
    cycle_id CHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status ENUM('pitch','bet','in_progress','done','dropped') NOT NULL DEFAULT 'pitch',
    appetite ENUM('small','big') NOT NULL DEFAULT 'small',
    project_name VARCHAR(255),
    tags JSON,
    position INT NOT NULL DEFAULT 0,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cycle_id) REFERENCES tracker_cycles(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_bet_assignees (
    bet_id CHAR(36) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (bet_id, user_id),
    FOREIGN KEY (bet_id) REFERENCES tracker_bets(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_scopes (
    id CHAR(36) PRIMARY KEY,
    bet_id CHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status ENUM('uphill','overhill','done') NOT NULL DEFAULT 'uphill',
    hill_position TINYINT UNSIGNED NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (bet_id) REFERENCES tracker_bets(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_scope_assignees (
    scope_id CHAR(36) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (scope_id, user_id),
    FOREIGN KEY (scope_id) REFERENCES tracker_scopes(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tracker_comments (
    id CHAR(36) PRIMARY KEY,
    target_type ENUM('bet','scope') NOT NULL,
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
    target_type ENUM('bet','scope') NOT NULL,
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

  `CREATE TABLE IF NOT EXISTS tracker_commit_links (
    id CHAR(36) PRIMARY KEY,
    scope_id CHAR(36) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    commit_hash VARCHAR(40) NOT NULL,
    commit_message TEXT,
    linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    linked_by VARCHAR(100) NOT NULL,
    FOREIGN KEY (scope_id) REFERENCES tracker_scopes(id) ON DELETE CASCADE,
    UNIQUE KEY uq_commit (project_name, repo_name, commit_hash)
  )`,
];

export async function runTrackerMigrations(): Promise<void> {
  const pool = getPool();
  for (const sql of MIGRATIONS) {
    await pool.execute(sql);
  }
  console.log("[tracker] Database migrations completed");
}
