# Claudemar

Telegram + Web interface for AI agent CLIs (OpenAI Codex CLI and Claude CLI, behind a provider layer; codex is the default). Manages projects, agents, and AI executions.

## Stack

- **Backend**: Node.js 22, TypeScript (ES2022 modules), Express 5, Socket.IO, grammy (Telegram)
- **Frontend**: React 19, Vite 7, Tailwind CSS 4, Monaco Editor, xterm.js
- **Deploy**: systemd service, install.sh, auto-update via cron

## Build

```bash
npm run build          # backend (tsup → dist/main.js)
npm run build:all      # dashboard + backend
npm run dev            # dev mode (tsx watch)
npm start              # production
```

## Structure

```
src/                   # Backend
  main.ts              # Entry point, wiring
  bot.ts               # Telegram bot setup, message handlers
  commands.ts          # All /commands and callback handlers
  config.ts            # Environment config (frozen object)
  execution-manager.ts # Agent CLI process lifecycle
  executor.ts          # Spawn/exec wrappers, output formatting
  providers/           # Provider adapters: claude.ts, codex.ts, types.ts, format.ts
  processor.ts         # Message → execution orchestration
  queue.ts             # Command queue (persisted, per-target)
  updater.ts           # Auto-update check and perform
  session.ts           # Per-chat state (project, agent, mode)
  telegram-format.ts   # Markdown→HTML, ANSI strip for Telegram
  agents/              # Agent management, scheduler, council, messenger
  server/              # Express routes, WebSocket, middleware, token manager
scripts/
  check-update.sh      # Cron script: fetch + notify Telegram
dashboard/src/         # React frontend
  pages/               # OverviewPage, ProjectDetailPage, AgentDetailPage
  components/          # UI components (overview, agent, project, shared, editor, terminal)
  hooks/               # useExecutions, useSocket, useOutput, etc.
  lib/                 # api client, socket, types, outputBuffer
install.sh             # Full installer (Node, repo, build, env, cron, systemd)
```

## Key Patterns

- Imports ALWAYS at top of file, `.js` extensions
- `config` is a frozen object from env vars
- Telegram handlers: `ctx.chat?.id` guard → early return if missing
- Inline keyboards: `bot.callbackQuery(/^prefix:/, handler)` pattern
- Persistence: JSON files in `config.basePath` with debounced writes
- Events: `executionManager` extends EventEmitter (output, complete, error, cancel)
- No comments unless critical. Code must be self-explanatory
- Production-ready only. No mocks, no hardcoded values
- Provider resolution: model `codex` → Codex CLI, `claude-*` → Claude CLI, none → `AGENT_PROVIDER` (default codex). Codex reports tokens (no USD cost) and never asks interactive questions; Claude reports USD cost and supports the question flow
- Agent instructions live in AGENTS.md (CLAUDE.md is legacy, auto-migrated on startup)
- NUNCA reiniciar o serviço local do claudemar (systemctl restart claudemar). O deploy e restart são feitos externamente

## Pre-existing Issues

- `src/server/routes/agents.ts` and `src/server/routes/projects.ts` have TypeScript errors (`string | string[]` not assignable to `string`) — pre-existing, not blocking tsup build
