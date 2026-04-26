#!/usr/bin/env bash
set -euo pipefail

TARGET_UID="${CLAUDE_UID:-1000}"
TARGET_GID="${CLAUDE_GID:-1000}"

if ! getent group "$TARGET_GID" &>/dev/null; then
  groupadd -g "$TARGET_GID" claude-user 2>/dev/null || true
fi

if ! id "$TARGET_UID" &>/dev/null; then
  GROUP_NAME=$(getent group "$TARGET_GID" | cut -d: -f1)
  useradd -u "$TARGET_UID" -g "${GROUP_NAME:-$TARGET_GID}" -d /home/claude-user -s /bin/bash -M claude-user 2>/dev/null || true
fi

/usr/local/bin/init-firewall.sh || true

exec gosu "$TARGET_UID:$TARGET_GID" "$@"
