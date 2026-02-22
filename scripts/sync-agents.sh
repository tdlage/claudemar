#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CLAUDEMAR_DIR:-$HOME/claudemar}"
DATA_DIR="${CLAUDEMAR_DATA:-$HOME/.claudemar}"
ENV_FILE="$INSTALL_DIR/.env"
AGENTS_DIR="$DATA_DIR/agents"
ORCHESTRATOR_DIR="$DATA_DIR/orchestrator"
AGENTS_MD="$ORCHESTRATOR_DIR/agents.md"
LOCK_FILE="$DATA_DIR/.sync-agents.lock"

if [[ ! -d "$AGENTS_DIR" ]]; then
    exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
    exit 0
fi

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    exit 0
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

distribute_agents_md() {
    [[ ! -f "$AGENTS_MD" ]] && return

    HEADER="# Agents Directory

This file is auto-generated. It lists all agents in the system and their roles.
Use this to know who to delegate tasks to via the messaging system.

## When to communicate with other agents

- **Delegate tasks outside your expertise**: if a task fits another agent's role better, send it to them instead of doing it yourself
- **Request information**: if another agent has context or expertise you need, ask them via a message
- **Report results**: when you finish a task delegated by the orchestrator or another agent, respond via outbox
- **Escalate to orchestrator**: if you receive a task you can't handle or need broader coordination, message \`orchestrator\`

## How to send a message

Create a file in your outbox/ folder with this naming:
\`PARA-<agent-name>_<timestamp>_<subject>.md\`

Example: \`PARA-Xandao_2025-02-10T18-30-45-123Z_review-task.md\`

The system will automatically route it to the agent's inbox as:
\`DE-<your-name>_<timestamp>_<subject>.md\`

To message the orchestrator, use \`PARA-orchestrator_<timestamp>_<subject>.md\`

## How to check for incoming messages

Read your inbox/ folder. Files named \`DE-<sender>_<timestamp>_<subject>.md\` are messages from other agents or the orchestrator.

---

"

    for agent_dir in "$AGENTS_DIR"/*/; do
        [[ ! -d "$agent_dir" ]] && continue
        context_dir="$agent_dir/context"
        mkdir -p "$context_dir"
        echo "${HEADER}$(cat "$AGENTS_MD")" > "$context_dir/agents.md"
    done
}

CHANGED_AGENTS=()
NOW=$(date +%s)
THRESHOLD=600

for agent_dir in "$AGENTS_DIR"/*/; do
    [[ ! -d "$agent_dir" ]] && continue

    claude_md="$agent_dir/CLAUDE.md"
    [[ ! -f "$claude_md" ]] && continue

    mtime=$(stat -c %Y "$claude_md" 2>/dev/null || echo 0)
    age=$(( NOW - mtime ))

    if (( age < THRESHOLD )); then
        agent_name=$(basename "$agent_dir")
        CHANGED_AGENTS+=("$agent_name")
    fi
done

if [[ ${#CHANGED_AGENTS[@]} -eq 0 ]]; then
    distribute_agents_md
    exit 0
fi

AGENT_LIST=""
for agent_name in "${CHANGED_AGENTS[@]}"; do
    claude_md="$AGENTS_DIR/$agent_name/CLAUDE.md"
    content=$(head -c 4000 "$claude_md" 2>/dev/null || echo "")
    AGENT_LIST+="
--- AGENT: $agent_name ---
$content
--- END AGENT ---
"
done

ALL_AGENTS=$(ls -1 "$AGENTS_DIR" 2>/dev/null | tr '\n' ', ')

EXISTING_MD=""
if [[ -f "$AGENTS_MD" ]]; then
    EXISTING_MD=$(cat "$AGENTS_MD" 2>/dev/null || echo "")
fi

PROMPT="Generate a markdown file summarizing agents for a multi-agent system. Output ONLY the markdown content, nothing else.

Current agents.md:
\`\`\`
$EXISTING_MD
\`\`\`

Agents with recently updated CLAUDE.md:
$AGENT_LIST

All existing agent directories: $ALL_AGENTS

Rules:
- For each changed agent, write a summary of AT MOST 3 lines describing what the agent does, its expertise, and when to delegate tasks to it
- Keep existing entries for agents NOT in the changed list (preserve them exactly)
- Remove entries for agents whose directories no longer exist
- Format: '## AgentName' header followed by 1-3 lines of description
- Output ONLY the raw markdown content. No code fences, no explanations, no preamble"

RESULT=$(cd /tmp && timeout 120 claude --print --model claude-haiku-4-5-20251001 --max-turns 1 "$PROMPT" 2>/dev/null) || true

if [[ -n "$RESULT" ]]; then
    echo "$RESULT" > "$AGENTS_MD"
fi

distribute_agents_md

flock -u 200
