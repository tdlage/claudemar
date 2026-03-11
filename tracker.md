# Shape Up Tracker

Sistema de gestão de projetos baseado na metodologia Shape Up. Organiza trabalho em **Projects → Cycles → Items**, com kanban board, test cases, comentários e controle de acesso por projeto.

## Arquitetura

- **Backend**: Node.js + Express + MySQL (`mysql2/promise`)
- **Frontend**: React + TypeScript + TailwindCSS
- **Realtime**: Socket.IO (room `tracker`, eventos prefixados com `tracker:`)
- **API base**: `/api/tracker`
- **Autenticação**: Todas as rotas requerem autenticação via `req.ctx`

---

## Banco de Dados (MySQL)

### tracker_projects

| Coluna | Tipo | Nullable | Default | Descrição |
|---|---|---|---|---|
| id | CHAR(36) | NOT NULL | — | PK (UUID) |
| name | VARCHAR(255) | NOT NULL | — | Nome do projeto |
| code | VARCHAR(10) | NOT NULL | — | Código curto único (ex: "PROJ"), UNIQUE |
| description | TEXT | NULL | — | Descrição opcional |
| next_bet_number | INT | NOT NULL | 1 | Sequencial auto-incrementado para items |
| created_by | VARCHAR(100) | NOT NULL | — | ID do criador |
| created_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP | — |

### tracker_cycles

| Coluna | Tipo | Nullable | Default | Descrição |
|---|---|---|---|---|
| id | CHAR(36) | NOT NULL | — | PK (UUID) |
| project_id | CHAR(36) | NOT NULL | — | FK → tracker_projects(id) CASCADE |
| name | VARCHAR(255) | NOT NULL | — | Nome do ciclo |
| status | ENUM('active','completed') | NOT NULL | 'active' | Status do ciclo |
| columns | JSON | NOT NULL | — | Array de colunas do kanban `[{id, name, color, position}]` |
| created_by | VARCHAR(100) | NOT NULL | — | ID do criador |
| created_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP | — |

Colunas padrão criadas automaticamente ao criar um ciclo:
1. Pendente (#6b7280, position 0)
2. Em andamento (#3b82f6, position 1)
3. Em teste (#f59e0b, position 2)
4. Em Correção (#ef4444, position 3)
5. Finalizado (#22c55e, position 4)

### tracker_bets (Items)

| Coluna | Tipo | Nullable | Default | Descrição |
|---|---|---|---|---|
| id | CHAR(36) | NOT NULL | — | PK (UUID) |
| cycle_id | CHAR(36) | NOT NULL | — | FK → tracker_cycles(id) CASCADE |
| title | VARCHAR(500) | NOT NULL | — | Título do item |
| description | TEXT | NULL | — | Descrição (markdown) |
| column_id | CHAR(36) | NOT NULL | — | ID da coluna atual no kanban |
| appetite | INT | NOT NULL | 7 | Apetite em dias |
| priority | VARCHAR(2) | NULL | NULL | Prioridade: P1, P2, P3, P4 ou P5 |
| started_at | DATETIME | NULL | NULL | Setado auto quando item sai da 1ª coluna |
| in_scope | TEXT | NULL | — | O que está no escopo |
| out_of_scope | TEXT | NULL | — | O que NÃO está no escopo |
| tags | JSON | NULL | — | Array de strings |
| seq_number | INT | NOT NULL | 0 | Número sequencial no projeto (ex: PROJ-42) |
| position | INT | NOT NULL | 0 | Ordem dentro da coluna |
| created_by | VARCHAR(100) | NOT NULL | — | ID do criador |
| created_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP | — |
| updated_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP ON UPDATE | — |

### tracker_item_assignees

| Coluna | Tipo | Descrição |
|---|---|---|
| item_id | CHAR(36) | FK → tracker_bets(id) CASCADE |
| user_id | VARCHAR(100) | ID do usuário |

PK composta: (item_id, user_id)

### tracker_comments

| Coluna | Tipo | Nullable | Default | Descrição |
|---|---|---|---|---|
| id | CHAR(36) | NOT NULL | — | PK (UUID) |
| target_type | ENUM('item') | NOT NULL | — | Tipo do alvo |
| target_id | CHAR(36) | NOT NULL | — | ID do item |
| author_id | VARCHAR(100) | NOT NULL | — | ID do autor |
| author_name | VARCHAR(255) | NOT NULL | — | Nome do autor |
| content | TEXT | NOT NULL | — | Conteúdo |
| created_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP | — |

INDEX: idx_target (target_type, target_id)

### tracker_attachments

| Coluna | Tipo | Descrição |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| comment_id | CHAR(36) | FK → tracker_comments(id) CASCADE |
| filename | VARCHAR(255) | Nome armazenado (UUID + extensão) |
| mime_type | VARCHAR(100) | Tipo MIME |
| size | INT UNSIGNED | Tamanho em bytes |
| uploaded_by | VARCHAR(100) | ID do uploader |
| uploaded_at | DATETIME | Timestamp |

### tracker_test_cases

| Coluna | Tipo | Nullable | Default | Descrição |
|---|---|---|---|---|
| id | CHAR(36) | NOT NULL | — | PK (UUID) |
| target_type | ENUM('item') | NOT NULL | — | Tipo do alvo |
| target_id | CHAR(36) | NOT NULL | — | ID do item |
| title | VARCHAR(500) | NOT NULL | — | Título |
| description | TEXT | NULL | — | Descrição |
| preconditions | TEXT | NULL | — | Pré-condições |
| steps | TEXT | NULL | — | Passos |
| expected_result | TEXT | NULL | — | Resultado esperado |
| priority | ENUM('critical','high','medium','low') | NOT NULL | 'medium' | Prioridade do teste |
| position | INT | NOT NULL | 0 | Ordem de exibição |
| created_by | VARCHAR(100) | NOT NULL | — | ID do criador |
| created_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP | — |
| updated_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP ON UPDATE | — |

### tracker_test_runs

| Coluna | Tipo | Nullable | Default | Descrição |
|---|---|---|---|---|
| id | CHAR(36) | NOT NULL | — | PK (UUID) |
| test_case_id | CHAR(36) | NOT NULL | — | FK → tracker_test_cases(id) CASCADE |
| status | ENUM('passed','failed','blocked','skipped') | NOT NULL | — | Resultado |
| notes | TEXT | NULL | — | Notas |
| executed_by | VARCHAR(100) | NOT NULL | — | ID do executor |
| executed_by_name | VARCHAR(255) | NOT NULL | — | Nome do executor |
| executed_at | DATETIME | NOT NULL | CURRENT_TIMESTAMP | — |
| duration_seconds | INT UNSIGNED | NULL | NULL | Duração em segundos |

### tracker_test_run_attachments

| Coluna | Tipo | Descrição |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| test_run_id | CHAR(36) | FK → tracker_test_runs(id) CASCADE |
| filename | VARCHAR(255) | Nome armazenado |
| mime_type | VARCHAR(100) | Tipo MIME |
| size | BIGINT UNSIGNED | Tamanho em bytes |
| uploaded_by | VARCHAR(100) | ID do uploader |
| uploaded_at | DATETIME | Timestamp |

### tracker_test_run_comments

| Coluna | Tipo | Descrição |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| test_run_id | CHAR(36) | FK → tracker_test_runs(id) CASCADE |
| author_id | VARCHAR(100) | ID do autor |
| author_name | VARCHAR(255) | Nome do autor |
| content | TEXT | Conteúdo |
| created_at | DATETIME | Timestamp |

### tracker_test_run_comment_attachments

| Coluna | Tipo | Descrição |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| comment_id | CHAR(36) | FK → tracker_test_run_comments(id) CASCADE |
| filename | VARCHAR(255) | Nome armazenado |
| mime_type | VARCHAR(100) | Tipo MIME |
| size | BIGINT UNSIGNED | Tamanho em bytes |
| uploaded_by | VARCHAR(100) | ID do uploader |
| uploaded_at | DATETIME | Timestamp |

### Relacionamentos

```
tracker_projects
  └── tracker_cycles (project_id → id, CASCADE)
        └── tracker_bets (cycle_id → id, CASCADE)
              └── tracker_item_assignees (item_id → id, CASCADE)

tracker_comments (target_type='item', target_id = bet.id)
  └── tracker_attachments (comment_id → id, CASCADE)

tracker_test_cases (target_type='item', target_id = bet.id)
  └── tracker_test_runs (test_case_id → id, CASCADE)
        ├── tracker_test_run_attachments (test_run_id → id, CASCADE)
        └── tracker_test_run_comments (test_run_id → id, CASCADE)
              └── tracker_test_run_comment_attachments (comment_id → id, CASCADE)
```

---

## API REST

Base: `/api/tracker`

### Controle de Acesso

- **Admin**: acesso total a tudo
- **Usuário**: acessa apenas projetos listados em `trackerProjects` do seu cadastro
- Rotas de projeto (CRUD) são admin-only
- Rotas de cycle/item verificam acesso ao projeto via `hasTrackerAccess`

### Projects

#### GET /projects
Lista projetos acessíveis ao usuário.
```
Response: TrackerProject[]
```

#### POST /projects (Admin only)
Cria um projeto.
```json
{
  "name": "Meu Projeto",       // obrigatório
  "code": "MP",                // obrigatório, 2-10 chars, auto-uppercase
  "description": "Descrição"   // opcional
}
```
Response: `201 TrackerProject`
Erros: `400` (campos faltando, code < 2 chars), `409` (code duplicado)

#### PUT /projects/:id (Admin only)
Atualiza projeto.
```json
{
  "name": "Novo Nome",         // opcional
  "description": "Nova desc"   // opcional
}
```
Response: `TrackerProject` | `404`

#### DELETE /projects/:id (Admin only)
Exclui projeto e todos os dados cascateados.
Response: `{ deleted: true }` | `404`

#### GET /projects/:projectId/members
Lista membros com acesso ao projeto (admin + usuários com o projeto em `trackerProjects`).
```json
Response: [{ "id": "user-id", "name": "Nome" }]
```

### Cycles

#### GET /projects/:projectId/cycles
Lista ciclos de um projeto (mais recentes primeiro).
```
Response: TrackerCycle[]
```

#### GET /projects/:projectId/cycle-stats
Estatísticas de itens por ciclo e coluna.
```json
{
  "<cycleId>": {
    "total": 12,
    "byColumn": { "<columnId>": 3 }
  }
}
```

#### POST /cycles
Cria ciclo (requer acesso ao projeto).
```json
{
  "projectId": "uuid",  // obrigatório
  "name": "Sprint 1"    // obrigatório
}
```
Response: `201 TrackerCycle`
Erros: `400`, `403`

#### PUT /cycles/:id
Atualiza ciclo (requer acesso ao projeto).
```json
{
  "name": "Novo nome",                    // opcional
  "status": "completed",                  // opcional: "active" | "completed"
  "columns": [{ "id": "...", "name": "...", "color": "#hex", "position": 0 }]  // opcional
}
```
Response: `TrackerCycle` | `404` | `403`

#### DELETE /cycles/:id
Exclui ciclo (requer acesso ao projeto).
Response: `{ deleted: true }` | `404` | `403`

### Items

#### GET /cycles/:cycleId/items
Lista items de um ciclo (ordenados por position, created_at).
```
Response: TrackerItem[]
```

#### POST /items
Cria item (requer acesso ao projeto do ciclo).
```json
{
  "cycleId": "uuid",         // obrigatório
  "title": "Fazer X",        // obrigatório
  "description": "Detalhes", // opcional
  "appetite": 7,             // opcional, default 7
  "priority": "P1",          // opcional: P1|P2|P3|P4|P5
  "inScope": "...",          // opcional
  "outOfScope": "...",       // opcional
  "assignees": ["user1"],    // opcional
  "tags": ["frontend"],      // opcional
  "columnId": "uuid"         // opcional, default = 1ª coluna
}
```
Response: `201 TrackerItem`
Erros: `400`, `403`

#### PUT /items/:id
Atualiza item. Todos os campos são opcionais.
```json
{
  "title": "Novo título",
  "description": "Nova desc",
  "columnId": "uuid",
  "appetite": 14,
  "priority": "P2",          // null para remover
  "inScope": "...",
  "outOfScope": "...",
  "assignees": ["user1", "user2"],
  "tags": ["backend"]
}
```
Response: `TrackerItem` | `404`

#### PATCH /items/:id/move
Move item para outra coluna/posição. Seta `startedAt` automaticamente quando sai da 1ª coluna pela primeira vez.
```json
{
  "columnId": "uuid",  // obrigatório
  "position": 0        // opcional, default 0
}
```
Response: `TrackerItem` | `400` | `404`

#### DELETE /items/:id
Exclui item (requer acesso ao projeto).
Response: `{ deleted: true }` | `404` | `403`

#### GET /items/search?q=texto
Busca itens por código do projeto, título ou código completo (ex: "PROJ-42"). Retorna até 20 resultados.
```json
[
  { "id": "uuid", "code": "PROJ-42", "title": "Título", "cycleId": "uuid", "columnId": "uuid" }
]
```

### Comments

#### GET /comments/:targetType/:targetId
Lista comentários (targetType deve ser "item").
```
Response: TrackerComment[]
```

#### POST /comments
Cria comentário em um item.
```json
{
  "targetType": "item",       // obrigatório
  "targetId": "uuid",         // obrigatório (ID do item)
  "content": "Meu comentário", // obrigatório
  "attachments": [             // opcional
    { "base64": "...", "filename": "foto.png", "mimeType": "image/png" }
  ]
}
```
Limites: imagens (png/jpeg/gif/webp) max 10MB; vídeos (mp4/webm/mov) max 100MB.
Response: `201 TrackerComment`

#### DELETE /comments/:id
Exclui comentário e remove arquivos do disco.
Response: `{ deleted: true }` | `404`

### Uploads (Signed URLs)

Attachments são servidos via URLs assinadas com HMAC-SHA256 (TTL 1h). A URL é incluída no campo `url` de cada attachment retornado pela API. Não há endpoint para gerar URLs manualmente — elas são geradas automaticamente pelo backend ao retornar attachments.

Rota pública (fora de `/api`, sem auth): `GET /files/tracker/:filename?exp=TIMESTAMP&sig=HMAC`

### Test Cases

#### GET /test-cases/:targetType/:targetId
Lista test cases de um item (targetType = "item").
```
Response: TrackerTestCase[] (com lastRunStatus, passCount, failCount, totalRuns)
```

#### POST /test-cases
Cria test case.
```json
{
  "targetType": "item",        // obrigatório
  "targetId": "uuid",          // obrigatório
  "title": "Testar login",     // obrigatório
  "description": "...",        // opcional
  "preconditions": "...",      // opcional
  "steps": "...",              // opcional
  "expectedResult": "...",     // opcional
  "priority": "high"           // opcional: critical|high|medium|low, default "medium"
}
```
Response: `201 TrackerTestCase`

#### PUT /test-cases/:id
Atualiza test case.
```json
{ "title": "...", "description": "...", "preconditions": "...", "steps": "...", "expectedResult": "...", "priority": "critical" }
```
Response: `TrackerTestCase` | `404`

#### DELETE /test-cases/:id
Exclui test case e todos os runs.
Response: `{ deleted: true }` | `404`

#### PATCH /test-cases/reorder
Reordena test cases.
```json
{ "ids": ["uuid1", "uuid2", "uuid3"] }
```
Response: `{ reordered: true }`

### Test Runs

#### GET /test-cases/:id/runs
Lista execuções de um test case (mais recentes primeiro).
```
Response: TrackerTestRun[]
```

#### POST /test-runs
Registra execução de teste.
```json
{
  "testCaseId": "uuid",        // obrigatório
  "status": "passed",          // obrigatório: passed|failed|blocked|skipped
  "notes": "Funcionou",        // opcional
  "durationSeconds": 120,      // opcional
  "attachments": [             // opcional
    { "base64": "...", "filename": "screenshot.png", "mimeType": "image/png" }
  ]
}
```
Response: `201 TrackerTestRun`

#### PUT /test-runs/:id
Atualiza execução.
```json
{ "status": "failed", "notes": "Bug encontrado", "durationSeconds": 60 }
```
Response: `TrackerTestRun` | `404`

#### DELETE /test-runs/:id
Exclui execução e remove attachments do disco.
Response: `{ deleted: true }` | `404`

#### POST /test-runs/:id/attachments
Upload de attachment adicional em uma execução.
```json
{ "base64": "...", "filename": "evidence.png", "mimeType": "image/png" }
```
Response: `201 TrackerTestRunAttachment`

### Test Run Comments

#### GET /test-runs/:id/comments
Lista comentários de uma execução.
```
Response: TrackerTestRunComment[]
```

#### POST /test-run-comments
Cria comentário em uma execução.
```json
{
  "testRunId": "uuid",          // obrigatório
  "content": "Comentário",     // obrigatório
  "attachments": [              // opcional
    { "base64": "...", "filename": "img.png", "mimeType": "image/png" }
  ]
}
```
Response: `201 TrackerTestRunComment`

---

## Índice Completo de Endpoints

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | /projects | Qualquer | Listar projetos acessíveis |
| POST | /projects | Admin | Criar projeto |
| PUT | /projects/:id | Admin | Atualizar projeto |
| DELETE | /projects/:id | Admin | Excluir projeto |
| GET | /projects/:pid/members | Qualquer | Listar membros do projeto |
| GET | /projects/:pid/cycles | Qualquer | Listar ciclos |
| GET | /projects/:pid/cycle-stats | Qualquer | Stats de itens por ciclo |
| POST | /cycles | Acesso ao projeto | Criar ciclo |
| PUT | /cycles/:id | Acesso ao projeto | Atualizar ciclo |
| DELETE | /cycles/:id | Acesso ao projeto | Excluir ciclo |
| GET | /cycles/:cid/items | Qualquer | Listar itens do ciclo |
| POST | /items | Acesso ao projeto | Criar item |
| PUT | /items/:id | Qualquer | Atualizar item |
| PATCH | /items/:id/move | Qualquer | Mover item no board |
| DELETE | /items/:id | Acesso ao projeto | Excluir item |
| GET | /items/search?q= | Qualquer | Buscar itens |
| GET | /comments/:type/:id | Qualquer | Listar comentários |
| POST | /comments | Qualquer | Criar comentário |
| DELETE | /comments/:id | Qualquer | Excluir comentário |
| GET | /files/tracker/:filename | Pública (signed) | Servir upload (fora /api) |
| GET | /test-cases/:type/:id | Qualquer | Listar test cases |
| POST | /test-cases | Qualquer | Criar test case |
| PUT | /test-cases/:id | Qualquer | Atualizar test case |
| DELETE | /test-cases/:id | Qualquer | Excluir test case |
| PATCH | /test-cases/reorder | Qualquer | Reordenar test cases |
| GET | /test-cases/:id/runs | Qualquer | Listar execuções |
| POST | /test-runs | Qualquer | Registrar execução |
| PUT | /test-runs/:id | Qualquer | Atualizar execução |
| DELETE | /test-runs/:id | Qualquer | Excluir execução |
| POST | /test-runs/:id/attachments | Qualquer | Upload de attachment |
| GET | /test-runs/:id/comments | Qualquer | Listar comentários de run |
| POST | /test-run-comments | Qualquer | Comentar em execução |

---

## Prioridades de Item

| Valor | Label | Cor |
|---|---|---|
| P1 | Urgente | vermelho (danger) |
| P2 | Alta | amarelo (warning) |
| P3 | Média | azul (accent) |
| P4 | Baixa | cinza (muted) |
| P5 | Muito baixa | cinza (muted) |

Campo `priority` é opcional (NULL = sem prioridade).

## Eventos WebSocket

Todos os eventos são emitidos na room `tracker` com prefixo `tracker:`.

| Evento | Payload |
|---|---|
| tracker:project:create | TrackerProject |
| tracker:project:update | TrackerProject |
| tracker:project:delete | { id } |
| tracker:cycle:create | TrackerCycle |
| tracker:cycle:update | TrackerCycle |
| tracker:cycle:delete | { id } |
| tracker:item:create | TrackerItem |
| tracker:item:update | TrackerItem |
| tracker:item:delete | { id } |
| tracker:comment:add | TrackerComment |
| tracker:comment:delete | { id } |
| tracker:testcase:create | TrackerTestCase |
| tracker:testcase:update | TrackerTestCase |
| tracker:testcase:delete | { id } |
| tracker:testcase:reorder | { ids } |
| tracker:testrun:create | TrackerTestRun |
| tracker:testrun:update | TrackerTestRun |
| tracker:testrun:delete | { id } |
| tracker:testrun:attachment | { testRunId, attachment } |
| tracker:testrun:comment | TrackerTestRunComment |

---

## Arquivos Principais

| Arquivo | Descrição |
|---|---|
| `src/tracker-migration.ts` | Schema DDL e migrações |
| `src/tracker-manager.ts` | Lógica de negócio (CRUD completo) |
| `src/server/routes/tracker.ts` | Rotas REST da API |
| `src/upload-signer.ts` | HMAC signed URLs para uploads |
| `src/server/websocket.ts` | Setup WebSocket + broadcast de eventos |
| `dashboard/src/lib/types.ts` | Tipos TypeScript do frontend |
| `dashboard/src/hooks/useTracker.ts` | Hooks React para consumo da API |
| `dashboard/src/components/tracker/constants.ts` | Constantes (prioridades, status, cores) |
| `dashboard/src/components/tracker/` | Componentes React do tracker |
