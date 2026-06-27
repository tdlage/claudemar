import { getPool } from "./database.js";

export type PipelineStage =
  | "intake"
  | "requirement"
  | "plan"
  | "implementation"
  | "code_review"
  | "e2e"
  | "pull_request"
  | "monitor";

export type IntakePluginType = "manual" | "github_issues" | "usage_pattern" | "agent";

export const PIPELINE_STAGES: { key: PipelineStage; label: string; color: string }[] = [
  { key: "requirement", label: "Requisito", color: "#6366f1" },
  { key: "plan", label: "Plano", color: "#3b82f6" },
  { key: "implementation", label: "Implementação", color: "#f59e0b" },
  { key: "code_review", label: "Code Review", color: "#ec4899" },
  { key: "e2e", label: "E2E", color: "#a855f7" },
  { key: "pull_request", label: "Pull Request", color: "#22c55e" },
  { key: "monitor", label: "Monitor", color: "#14b8a6" },
];

export const STAGE_ORDER: PipelineStage[] = PIPELINE_STAGES.map((s) => s.key);

const STAGE_ENUM = "ENUM('intake','requirement','plan','implementation','code_review','e2e','pull_request','monitor')";
const INTAKE_TYPE_ENUM = "ENUM('manual','github_issues','usage_pattern','agent')";

export interface DefaultStageConfig {
  stage: PipelineStage;
  promptTemplate: string;
  skill: string | null;
  agentName: string | null;
}

export const DEFAULT_STAGE_CONFIGS: DefaultStageConfig[] = [
  {
    stage: "requirement",
    skill: null,
    agentName: null,
    promptTemplate: `Você é responsável por transformar a ideia de captação abaixo em um requisito de software claro e acionável.
Antes de escrever, consulte a memória de longo prazo (mcp__memory__search_memory) por features relacionadas, já entregues ou em andamento, para manter coerência e evitar retrabalho.
Produza um requisito em markdown com: objetivo, contexto/motivação, critérios de aceitação verificáveis, escopo e fora-de-escopo.
Ao finalizar, chame mcp__pipeline__report_requirement com o requisito completo.`,
  },
  {
    stage: "plan",
    skill: null,
    agentName: null,
    promptTemplate: `Elabore o plano de implementação e a arquitetura para o requisito abaixo.
Explore o código nas worktrees listadas para embasar as decisões. Defina abordagem, arquivos a alterar, riscos e estratégia de testes.
Determine exatamente QUAIS repositórios do projeto serão alterados.
Ao finalizar, chame mcp__pipeline__report_plan com { plan_markdown, repos: [nomes dos repositórios que serão tocados] }.`,
  },
  {
    stage: "implementation",
    skill: null,
    agentName: null,
    promptTemplate: `Implemente o plano abaixo nas worktrees indicadas, com código pronto para produção (sem mocks, sem hardcode, imports no topo).
Cubra a mudança com testes automatizados e EXECUTE-OS. Faça commits atômicos e descritivos.
Se houver feedback de revisão/testes/E2E anterior, trate-o primeiro.
Ao finalizar, chame mcp__pipeline__report_test_result com { passed, total, failed, logs }.`,
  },
  {
    stage: "code_review",
    skill: "code-review",
    agentName: null,
    promptTemplate: `Execute o /code-review em alta intensidade aplicando as correções (--fix) sobre o diff desta worktree em relação à branch base.
Corrija TODOS os pontos identificados. Em seguida, rode novamente os testes automatizados para garantir que nada quebrou.
Repita o /code-review até não restar nenhum finding e os testes passarem.
Ao finalizar, chame mcp__pipeline__report_code_review com { total_findings, fixed, clean, tests_pass, summary }.`,
  },
  {
    stage: "e2e",
    skill: "verify",
    agentName: null,
    promptTemplate: `Execute um teste end-to-end real da funcionalidade implementada, exercitando o fluxo do usuário.
Capture evidências (screenshots e logs) e salve os arquivos no diretório de artefatos informado no contexto.
Ao finalizar, chame mcp__pipeline__report_e2e com { passed, screenshots: [nomes dos arquivos salvos], logs }.`,
  },
  {
    stage: "pull_request",
    skill: null,
    agentName: null,
    promptTemplate: `Para CADA repositório alterado por este card, faça push da branch.
Se JÁ existe um PR aberto para essa branch (verifique com 'gh pr view' / 'gh pr list --head <branch>'), o push já o atualiza — NÃO crie outro. Caso contrário, abra um Pull Request com o gh CLI.
No corpo do PR (ao criar) inclua as evidências: resumo do requisito, plano, resultado dos testes automatizados, resultado do code-review e evidências do E2E.
Chame mcp__pipeline__report_pull_request UMA VEZ POR REPOSITÓRIO com { repo, url, number } (do PR existente ou recém-criado).`,
  },
  {
    stage: "monitor",
    skill: null,
    agentName: null,
    promptTemplate: `Acompanhe o estado dos Pull Requests deste card. Esta etapa é majoritariamente passiva: comentários humanos e reviews "changes requested" retroalimentam o fluxo automaticamente via webhook.
Se receber instruções de acompanhamento, resuma o status atual de cada PR.`,
  },
];

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS pipeline_pipelines (
    id CHAR(36) PRIMARY KEY,
    project_name VARCHAR(255) NOT NULL,
    default_base_branch VARCHAR(255) NOT NULL DEFAULT 'main',
    next_card_number INT NOT NULL DEFAULT 1,
    default_auto TINYINT(1) NOT NULL DEFAULT 0,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_project (project_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pipeline_stage_configs (
    id CHAR(36) PRIMARY KEY,
    pipeline_id CHAR(36) NOT NULL,
    stage ${STAGE_ENUM} NOT NULL,
    prompt_template LONGTEXT NOT NULL,
    skill VARCHAR(255) DEFAULT NULL,
    agent_name VARCHAR(255) DEFAULT NULL,
    timeout_ms INT NOT NULL DEFAULT 0,
    FOREIGN KEY (pipeline_id) REFERENCES pipeline_pipelines(id) ON DELETE CASCADE,
    UNIQUE KEY uk_pipeline_stage (pipeline_id, stage)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pipeline_intake_plugins (
    id CHAR(36) PRIMARY KEY,
    pipeline_id CHAR(36) NOT NULL,
    type ${INTAKE_TYPE_ENUM} NOT NULL,
    name VARCHAR(255) NOT NULL,
    config JSON NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    cron VARCHAR(120) DEFAULT NULL,
    schedule_id VARCHAR(36) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pipeline_id) REFERENCES pipeline_pipelines(id) ON DELETE CASCADE,
    INDEX idx_pipeline (pipeline_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pipeline_cards (
    id CHAR(36) PRIMARY KEY,
    pipeline_id CHAR(36) NOT NULL,
    seq_number INT NOT NULL DEFAULT 0,
    title VARCHAR(500) NOT NULL,
    stage ${STAGE_ENUM} NOT NULL DEFAULT 'requirement',
    status ENUM('idle','running','awaiting_gate','failed','done') NOT NULL DEFAULT 'idle',
    auto TINYINT(1) NOT NULL DEFAULT 0,
    origin_type ${INTAKE_TYPE_ENUM} NOT NULL DEFAULT 'manual',
    origin_ref VARCHAR(500) DEFAULT NULL,
    intake_input LONGTEXT DEFAULT NULL,
    requirement_text LONGTEXT DEFAULT NULL,
    plan_markdown LONGTEXT DEFAULT NULL,
    session_id VARCHAR(255) DEFAULT NULL,
    implementation_retries INT NOT NULL DEFAULT 0,
    code_review_retries INT NOT NULL DEFAULT 0,
    e2e_retries INT NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    last_feedback LONGTEXT DEFAULT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (pipeline_id) REFERENCES pipeline_pipelines(id) ON DELETE CASCADE,
    INDEX idx_pipeline_stage (pipeline_id, stage)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pipeline_card_repos (
    id CHAR(36) PRIMARY KEY,
    card_id CHAR(36) NOT NULL,
    repo_name VARCHAR(255) NOT NULL,
    base_branch VARCHAR(255) NOT NULL DEFAULT 'main',
    branch VARCHAR(255) DEFAULT NULL,
    worktree_path VARCHAR(1024) DEFAULT NULL,
    pr_url VARCHAR(1024) DEFAULT NULL,
    pr_number INT DEFAULT NULL,
    repo_status ENUM('pending','worktree','pushed','pr_open','merged','closed') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES pipeline_cards(id) ON DELETE CASCADE,
    UNIQUE KEY uk_card_repo (card_id, repo_name),
    INDEX idx_pr_number (pr_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pipeline_stage_runs (
    id CHAR(36) PRIMARY KEY,
    card_id CHAR(36) NOT NULL,
    stage ${STAGE_ENUM} NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    exec_id VARCHAR(36) DEFAULT NULL,
    session_id VARCHAR(255) DEFAULT NULL,
    status ENUM('running','passed','failed','error','cancelled') NOT NULL DEFAULT 'running',
    prompt_sent LONGTEXT DEFAULT NULL,
    output LONGTEXT DEFAULT NULL,
    artifacts JSON DEFAULT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME DEFAULT NULL,
    FOREIGN KEY (card_id) REFERENCES pipeline_cards(id) ON DELETE CASCADE,
    INDEX idx_card (card_id),
    INDEX idx_exec (exec_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function runPipelineMigrations(): Promise<void> {
  const pool = getPool();
  for (const sql of MIGRATIONS) {
    await pool.execute(sql);
  }
  console.log("[pipeline] Database migrations completed");
}
