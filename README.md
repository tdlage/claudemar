# Claudemar

Telegram bot that gives you full access to Claude CLI from your phone. Manage projects, orchestrate AI agents, schedule tasks, and monitor everything through a web dashboard.

## Features

### Telegram Bot
- **Claude CLI via Telegram** — send messages, get Claude responses with streaming
- **Voice messages** — transcribed via OpenAI Whisper, then processed by Claude
- **Project management** — clone repos, switch between projects, run git/shell commands
- **Multi-agent system** — create specialized agents with personas, context files, and inboxes
- **Agent-to-agent messaging** — outbox/inbox routing, broadcast, delegation
- **Council meetings** — simulate multi-agent discussions on a topic
- **Cron scheduling** — natural language schedules ("every day at 9am review PRs")
- **Execution metrics** — track cost, duration, and execution count per agent

### Web Dashboard
- **Overview** — active executions, agent/project status, activity feed, quick command
- **Agent management** — inbox, outbox, output files, context, config, schedules
- **Project management** — git log, file browser, execution history
- **Code editor** — Monaco Editor with syntax highlighting, multi-file tabs, Ctrl+S save
- **File watching** — real-time updates when files change on disk
- **Execution logs** — search, filter by status/target, pagination
- **Command palette** — Ctrl+K to quickly navigate anywhere
- **Responsive layout** — collapsible sidebar, works on tablet
- **Authentication** — token-based with rate limiting (120 req/min)

## Requirements

- Node.js >= 22
- [Claude CLI](https://github.com/anthropics/claude-code) installed and authenticated (`claude auth`)
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

The Dockerfile uses a multi-stage build (dashboard → backend → runtime) with `node:22-slim`. Data is persisted in `./data/` via volumes.

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
CLAUDE_TIMEOUT_MS=300000                  # Claude execution timeout (default: 5min)
MAX_OUTPUT_LENGTH=4096                    # max inline output before sending as file
MAX_BUFFER_SIZE=10485760                  # max process buffer (10MB)
DASHBOARD_TOKEN=your-secret-token        # dashboard auth token (empty = localhost only)
DASHBOARD_PORT=3000                       # dashboard port (default: 3000)
BASE_PATH=/path/to/data                   # base directory for agents/projects/orchestrator
```

**Getting your chat ID:** send any message to the bot, check the logs for `ALLOWED_CHAT_ID`.

**Dashboard access:** when `DASHBOARD_TOKEN` is set, the dashboard binds to `0.0.0.0` and requires the token to access. When empty, it binds to `127.0.0.1` (localhost only, no auth).

## Telegram Commands

### Projects
| Command | Description |
|---------|-------------|
| `/project` | Select active project (shows inline keyboard) |
| `/add <url> [name]` | Clone a git repository as a project |
| `/remove <project>` | Delete a project |
| `/exec <cmd>` | Run a shell command in the active project |
| `/git <subcmd>` | Run a git command in the active project |

### Agents
| Command | Description |
|---------|-------------|
| `/agent` | List agents (shows inline keyboard for selection) |
| `/agent create <name>` | Create a new agent with directory structure |
| `/agent remove <name>` | Delete an agent and its schedules |
| `/agent info <name>` | Show agent details (context, inbox, output, schedules) |
| `/agent context <name> add <text\|url>` | Add context (text or URL) to an agent |
| `/delegate <agent> <prompt>` | Execute a prompt on a specific agent |
| `/inbox [agent]` | Check inbox messages for an agent |
| `/broadcast <msg>` | Send a message to all agents |
| `/council <topic>` | Simulate a multi-agent discussion |

### Scheduling
| Command | Description |
|---------|-------------|
| `/schedule <agent> <instruction>` | Create a cron schedule from natural language |
| `/schedule list` | List all active schedules |
| `/schedule remove <id>` | Remove a schedule |

### General
| Command | Description |
|---------|-------------|
| `/mode` | Toggle between projects and agents mode |
| `/current` | Show current session state |
| `/metrics [agent]` | View execution metrics (cost, duration, count) |
| `/clear` | Reset session state |
| `/help` | Show all commands |

### Text & Voice Messages
Send any text message to get a Claude response in the active project/agent context. Send a voice message and it will be transcribed via Whisper and processed by Claude.

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
| GET | `/api/agents/:name` | Agent detail (inbox, outbox, output, context, schedules) |
| POST | `/api/agents` | Create agent (`{ name }`) |
| DELETE | `/api/agents/:name` | Delete agent |
| GET | `/api/agents/:name/inbox/:file` | Read inbox file |
| POST | `/api/agents/:name/inbox/:file/archive` | Archive inbox file |
| DELETE | `/api/agents/:name/inbox/:file` | Delete inbox file |
| POST | `/api/agents/:name/outbox` | Send message (`{ recipient, content }`) |
| GET | `/api/agents/:name/outbox/:file` | Read outbox file |
| DELETE | `/api/agents/:name/outbox/:file` | Delete outbox file |
| GET | `/api/agents/:name/output/:file` | Read output file |
| GET | `/api/agents/:name/context/:file` | Read context file |
| POST | `/api/agents/:name/context` | Add context (`{ filename, content }`) |
| DELETE | `/api/agents/:name/context/:file` | Delete context file |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:name` | Project detail with git info |
| GET | `/api/projects/:name/git-log` | Last 50 commits |
| POST | `/api/projects` | Clone repo (`{ url, name? }`) |
| DELETE | `/api/projects/:name` | Delete project |

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
    CLAUDE.md         # Agent persona/instructions
    context/          # Reference materials
    inbox/            # Incoming messages from other agents
    outbox/           # Outgoing messages (routed automatically)
    output/           # Execution outputs and scheduled task results
```

## Development

```bash
# Backend (with hot reload)
npm run dev

# Dashboard (Vite dev server with proxy)
npm run dev:dashboard

# Type check
npx tsc --noEmit                          # backend
cd dashboard && npx tsc --noEmit          # dashboard

# Full build
npm run build:all
```

## Architecture

```
src/
  main.ts                  # Entry point: starts bot + dashboard server
  bot.ts                   # Grammy bot instance
  commands.ts              # All Telegram command handlers
  processor.ts             # Message processing + delegation
  executor.ts              # Claude CLI spawning, shell execution
  execution-manager.ts     # Singleton execution tracker (EventEmitter)
  session.ts               # Per-chat session state
  config.ts                # Environment configuration
  metrics.ts               # Agent execution metrics
  transcription.ts         # OpenAI Whisper voice transcription
  agents/
    manager.ts             # Agent CRUD operations
    messenger.ts           # Outbox → inbox message routing
    council.ts             # Multi-agent council simulation
    scheduler.ts           # Cron scheduling with Claude
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
