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
Use this directory to choose an agent whose expertise fits the task.

## Delegating work

Use the subagent tools exposed by the current runtime, with the agent name and a clear task.
The subagent returns its result in the current conversation. Use context/ for reference
material, input/ for supplied files, and output/ for results.

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

find_agent_md() {
    local agent_dir="$1"
    if [[ -f "$agent_dir/AGENTS.md" ]]; then
        echo "$agent_dir/AGENTS.md"
    elif [[ -f "$agent_dir/CLAUDE.md" ]]; then
        echo "$agent_dir/CLAUDE.md"
    fi
}

for agent_dir in "$AGENTS_DIR"/*/; do
    [[ ! -d "$agent_dir" ]] && continue

    agent_md=$(find_agent_md "${agent_dir%/}")
    [[ -z "$agent_md" ]] && continue

    mtime=$(stat -c %Y "$agent_md" 2>/dev/null || echo 0)
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
    agent_md=$(find_agent_md "$AGENTS_DIR/$agent_name")
    content=$(head -c 4000 "$agent_md" 2>/dev/null || echo "")
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

Agents with recently updated AGENTS.md:
$AGENT_LIST

All existing agent directories: $ALL_AGENTS

Rules:
- For each changed agent, write a summary of AT MOST 3 lines describing what the agent does, its expertise, and when to delegate tasks to it
- Keep existing entries for agents NOT in the changed list (preserve them exactly)
- Remove entries for agents whose directories no longer exist
- Format: '## AgentName' header followed by 1-3 lines of description
- Output ONLY the raw markdown content. No code fences, no explanations, no preamble"

LAST_MSG_FILE=$(mktemp)
(cd /tmp && timeout 120 codex exec --skip-git-repo-check -s read-only --output-last-message "$LAST_MSG_FILE" "$PROMPT" >/dev/null 2>&1) || true
RESULT=$(cat "$LAST_MSG_FILE" 2>/dev/null || echo "")
rm -f "$LAST_MSG_FILE"

if [[ -z "$RESULT" ]] && command -v claude >/dev/null 2>&1; then
    RESULT=$(cd /tmp && timeout 120 claude --print --model claude-haiku-4-5-20251001 --max-turns 1 "$PROMPT" 2>/dev/null) || true
fi

if [[ -n "$RESULT" ]]; then
    echo "$RESULT" > "$AGENTS_MD"
fi

distribute_agents_md

flock -u 200
