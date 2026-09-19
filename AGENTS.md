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
npm run typecheck      # backend types and unused locals
npm run check:unused   # unused files, exports and dependencies across backend + dashboard
```

## Structure

```
src/                   # Backend
  main.ts              # Entry point, wiring
  bot.ts               # Telegram authentication, token and update commands
  commands.ts          # All /commands and callback handlers
  config.ts            # Environment config (frozen object)
  execution-manager.ts # Agent CLI process lifecycle
  executor.ts          # Shell execution wrappers
  providers/           # LLM profiles, shared types and output formatting
  runtime/             # Shared session lifecycle and MCP wiring
  claude/, codex/       # Runtime implementations
  processor.ts         # Message → execution orchestration
  queue.ts             # Command queue (persisted, per-target)
  updater.ts           # Auto-update check and perform
  session.ts           # Project names and workspace paths
  agents/              # Agent management, scheduler, subagent definitions
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
- Provider resolution: model selection and persisted target/session preferences resolve a configured LLM profile and its Claude or Codex runtime. Codex reports tokens (no USD cost) and asks questions through `mcp__user_input__request_user_input`; Claude reports USD cost and uses `AskUserQuestion`. Both publish questions during execution and wait for the user's answers in the tool call before continuing
- Agent instructions live in AGENTS.md (CLAUDE.md is legacy, auto-migrated on startup)
- NUNCA reiniciar o serviço local do claudemar (systemctl restart claudemar). O deploy e restart são feitos externamente

## Static Analysis

`knip.json` includes the main application, standalone schedule/pipeline runners and tests. The supplied DANTUI source is intentionally excluded from unused-export cleanup to keep the vendor kit unchanged; `crontab` is a system executable, not an npm dependency. Internally used exports remain valid.
