# Claudemar

Web workspace for AI agents using the Codex and Claude runtimes, with Telegram access for authentication tokens and updates. Manage projects, orchestrate AI agents, schedule tasks, and monitor everything through a web dashboard.

## Providers

Claudemar supports two agent CLIs behind a provider layer:

| | Codex CLI (default) | Claude CLI |
|---|---|---|
| Package | `@openai/codex` | `@anthropic-ai/claude-code` |
| Auth | `codex login` (ChatGPT account) | `claude auth` |
| Model selection | `codex` (account default) | `claude-*` models |
| Usage reporting | tokens | USD cost |
| Interactive questions | supported | supported |

The selected model and provider profile determine the runtime. Configure provider profiles in Settings; project, agent and session preferences retain the chosen model.

## Features

### Telegram Bot
- **Access token** — retrieve the current dashboard token with `/token`
- **Updates** — check for updates with `/update` and apply them from the confirmation message

### Web Dashboard
- **Overview** — active executions, agent/project status, activity feed, quick command
- **Agent management** — input/output files, context, configuration, subagents and schedules
- **Project management** — repository browser with branches, log, git operations, file browser
- **Code editor** — Monaco Editor with syntax highlighting, multi-file tabs, Ctrl+S save
- **File watching** — real-time updates when files change on disk
- **Execution logs** — search, filter by status/target, pagination
- **Command palette** — Ctrl+K to quickly navigate anywhere
- **Responsive layout** — collapsible sidebar, works on tablet
- **Authentication** — rotating tokens, passkeys and access permissions

## Requirements

- Node.js >= 22
- [Codex CLI](https://github.com/openai/codex) installed and authenticated (`npm install -g @openai/codex && codex login`)
- [Claude CLI](https://github.com/anthropics/claude-code) installed and authenticated (`claude auth`) — optional, enables `claude-*` models
- Telegram bot token (from [@BotFather](https://t.me/BotFather))
- OpenAI API key (optional, for voice message transcription)

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/tdlage/claudemar/main/install.sh | bash
```

The installer handles everything: Node.js, cloning, building, `.env` setup, and systemd service (Linux) or run instructions (macOS).

## Manual Install

```bash
git clone https://github.com/tdlage/claudemar.git
cd claudemar

npm ci
cd dashboard && npm ci && cd ..

cp .env.example .env   # edit with your credentials
npm run build:all
node dist/main.js
```

## Docker

```bash
git clone https://github.com/tdlage/claudemar.git
cd claudemar

cp .env.example .env   # edit with your credentials
docker compose up -d
```

The Dockerfile builds the dashboard and all backend entry points with `node:22-slim`. Data is persisted in `./data/` via volumes. This is an optional application deployment; agent execution no longer uses a separate Docker image or a rebuild action.

For installations running Claudemar through systemd, the supporting services can be started separately:

```bash
docker compose up -d mysql redis whatsapp-bridge
```

Configure the host application to use the published MySQL port (`MYSQL_PORT=3307` for this Compose file), Redis and WhatsApp bridge endpoints.

For HTTPS, a `Caddyfile` is included:

```bash
DOMAIN=claudemar.example.com docker compose up -d
# Then run Caddy pointing to the Caddyfile
```

## Configuration

Create a `.env` file in the project root:

```env
# Required
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
ALLOWED_CHAT_ID=your-telegram-chat-id

# Optional
OPENAI_API_KEY=your-openai-key           # for voice message transcription
AGENT_TIMEOUT_MS=300000                   # agent execution timeout (0 = no timeout)
SESSION_INACTIVITY_TIMEOUT_MS=0           # optional cutoff without runner events; disabled by default
MAX_BUFFER_SIZE=10485760                  # max process buffer (10MB)
DASHBOARD_TOKEN=your-secret-token        # dashboard auth token (empty = localhost only)
DASHBOARD_PORT=3000                       # dashboard port (default: 3000)
BASE_PATH=/path/to/data                   # base directory for agents/projects/orchestrator
```

**Getting your chat ID:** send any message to the bot, check the logs for `ALLOWED_CHAT_ID`.

**Dashboard access:** the API requires authentication. Use `/token` in Telegram to obtain the rotating administrator token; `DASHBOARD_TOKEN` optionally provides a permanent master token. Users can also have individual access tokens, and administrators can register passkeys.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/token` | Get the current dashboard access token |
| `/update` | Check for updates and confirm installation |

Projects, conversations, agents and schedules are managed through the dashboard. Audio transcription is available in the conversation input.

## Dashboard API

All endpoints require `Authorization: Bearer <DASHBOARD_TOKEN>` header.

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/system/status` | Session snapshot, uptime, active executions |
| GET | `/api/system/metrics` | Agent execution metrics |

### Agents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:name` | Agent detail (input, output, context and schedules) |
| POST | `/api/agents` | Create agent (`{ name }`) |
| DELETE | `/api/agents/:name` | Delete agent |
| GET | `/api/agents/:name/output/:file` | Read output file |
| GET | `/api/agents/:name/context/:file` | Read context file |
| POST | `/api/agents/:name/context` | Add context (`{ filename, content }`) |
| DELETE | `/api/agents/:name/context/:file` | Delete context file |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:name` | Project detail with repos list |
| POST | `/api/projects` | Create project folder (`{ name }`) |
| DELETE | `/api/projects/:name` | Delete project |
| GET | `/api/projects/:name/repos` | List repos in project |
| POST | `/api/projects/:name/repos` | Clone repo (`{ url, name? }`) |
| DELETE | `/api/projects/:name/repos/:repo` | Remove repo |
| GET | `/api/projects/:name/repos/:repo/log` | Commit log |
| GET | `/api/projects/:name/repos/:repo/branches` | Branch list |
| POST | `/api/projects/:name/repos/:repo/checkout` | Checkout branch (`{ branch }`) |
| POST | `/api/projects/:name/repos/:repo/pull` | Git pull |
| POST | `/api/projects/:name/repos/:repo/stash` | Git stash (`{ pop?: boolean }`) |
| POST | `/api/projects/:name/repos/:repo/fetch` | Git fetch |

### Executions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/executions` | List active + recent executions |
| POST | `/api/executions` | Start execution (`{ targetType, targetName, prompt }`) |
| POST | `/api/executions/:id/stop` | Cancel execution |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files?base=...&path=...` | Read file or list directory |
| PUT | `/api/files?base=...&path=...` | Save file (`{ content }`) |
| DELETE | `/api/files?base=...&path=...` | Delete file |

`base` values: `orchestrator`, `agent:<name>`, `project:<name>`

### WebSocket Events

Connect via Socket.IO with `{ auth: { token } }`.

| Room | Event | Description |
|------|-------|-------------|
| `executions` | `execution:start` | Execution started |
| `executions` | `execution:complete` | Execution finished |
| `executions` | `execution:error` | Execution failed |
| `executions` | `execution:cancel` | Execution cancelled |
| `exec:<id>` | `execution:output` | Streaming output chunk |
| `files` | `file:changed` | File changed on disk (`{ event, base, path }`) |

Subscribe to rooms: emit `subscribe:execution <id>`, `subscribe:files`. Unsubscribe: `unsubscribe:execution <id>`, `unsubscribe:files`.

## Agent Directory Structure

```
agents/
  my-agent/
    AGENTS.md         # Agent persona/instructions
    context/          # Reference materials
    input/            # Files supplied to the agent
    output/           # Execution outputs and scheduled task results
    schedules/        # Generated cron scripts and logs
```

## Development

```bash
# Backend (with hot reload)
npm run dev

# Dashboard (Vite dev server with proxy)
npm run dev:dashboard

# Type check
npm run typecheck                        # backend, including unused locals
(cd dashboard && npx tsc -b)             # dashboard

# Unused files, exports and dependencies (backend + dashboard)
npm run check:unused

# Full build
npm run build:all
```

## Architecture

```
src/
  main.ts                  # Entry point: starts bot + dashboard server
  bot.ts                   # Grammy bot instance
  commands.ts              # All Telegram command handlers
  processor.ts             # Queue processing and execution orchestration
  executor.ts              # Agent CLI spawning, shell execution
  providers/               # Provider profiles and shared types
  runtime/                 # Shared session lifecycle
  claude/                  # Claude runtime
  codex/                   # Codex runtime
  execution-manager.ts     # Singleton execution tracker (EventEmitter)
  repositories.ts          # Git repository discovery and operations
  session.ts               # Project names and workspace paths
  config.ts                # Environment configuration
  metrics.ts               # Agent execution metrics
  transcription.ts         # OpenAI Whisper voice transcription
  agents/
    manager.ts             # Agent CRUD operations
    subagents.ts           # Agent definitions for delegation
    scheduler.ts           # Scheduler tools, MySQL records and cron scripts
    types.ts               # Agent type definitions
  server/
    index.ts               # Express + Socket.IO setup
    middleware.ts           # Auth middleware
    websocket.ts            # Socket.IO events + file watching
    file-watcher.ts        # Chokidar file system watcher
    routes/
      agents.ts            # /api/agents
      projects.ts          # /api/projects
      executions.ts        # /api/executions
      files.ts             # /api/files
      system.ts            # /api/system

dashboard/                 # React + Vite + Tailwind
  src/
    pages/                 # Overview, AgentDetail, ProjectDetail, Editor, Logs, Login
    components/
      layout/              # Sidebar, Header, Layout
      editor/              # FileTree, MonacoEditor, EditorTabs
      overview/            # AgentStatusGrid, ProjectStatusGrid, ActivityFeed, etc
      terminal/            # xterm.js terminal component
      shared/              # Button, Card, Modal, Toast, Badge, Tabs
      CommandPalette.tsx   # Ctrl+K command palette
    hooks/                 # useAuth, useSocket, useExecution, useDebounce
    lib/                   # API client, socket client, types
```

## License

MIT

### Project repository availability

In Projects → Repositories, use **Hide from agent** or **Make available** to control which repositories are physically present in the project workspace. All repositories are available by default. Hiding moves the entire directory, including `.git` and uncommitted files, into `data/hidden-repositories/<project-path-hash>/` outside the project. Restoring moves it back. The directory location is the persistent state, so no startup migration or prompt-based repository list is needed.

Hidden repositories remain listed in the dashboard, but are excluded from normal repository discovery and pipeline repository selection. Restore a repository before using its Git actions. Deleting the project also deletes its hidden repositories. Visibility changes are rejected during active project executions, on destination conflicts, for symlink repositories, and for repositories with linked worktrees. The project root repository cannot be hidden. Moves require the storage and project to reside on the same filesystem; a failed move leaves the source intact.

This removes repositories from the executor workspace; it does not add an operating-system read sandbox. Runtimes with unrestricted filesystem access can still access paths outside the workspace. Existing conversation history is not erased by changing repository availability.

### Model selection across providers

Settings configures provider profiles and account credentials. There is no global provider switch: the model selector in project, agent, and orchestrator terminals lists models grouped by every authenticated provider. Native Claude uses its login or configured Anthropic credentials, native Codex uses its ChatGPT login, and custom profiles require their configured token environment variable. The catalog includes the native model list and each profile's primary, secondary, and light models.

When opening a terminal, its initial model comes from the latest execution in that target’s Activity, including persisted history after a restart. If the exact model cannot be identified, Claude defaults to Opus 5 and Codex to GPT-6 Astra. A manual selection is retained for the next submission.

Choosing a model persists the provider and model together in `data/target-models.json`. Agent schedules use the agent's preference. Queued prompts retain the selection from when they were submitted. Each execution receives its own provider configuration; selecting a model does not change another project's or agent's provider. The selector is disabled while the terminal has an active execution.

Legacy project preferences are adopted when first resolved. Unavailable saved models require a new selection instead of silently switching providers. Provider identity is also stored for sessions, so switching providers starts a compatible session. The old Settings active-profile field is retained only for migration compatibility.
