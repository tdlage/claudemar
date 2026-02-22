#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CLAUDEMAR_DIR:-$HOME/claudemar}"
DATA_DIR="${CLAUDEMAR_DATA:-$HOME/.claudemar}"
ENV_FILE="$INSTALL_DIR/.env"
NOTIFIED_FILE="$DATA_DIR/.update-notified"

if [[ ! -f "$ENV_FILE" ]]; then
    exit 0
fi

TELEGRAM_BOT_TOKEN="$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.+' "$ENV_FILE" 2>/dev/null || true)"
ALLOWED_CHAT_ID="$(grep -oP '^ALLOWED_CHAT_ID=\K.+' "$ENV_FILE" 2>/dev/null || true)"

if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$ALLOWED_CHAT_ID" ]]; then
    exit 0
fi

cd "$INSTALL_DIR"

git fetch origin --quiet 2>/dev/null || exit 0

LOCAL=$(git rev-parse HEAD 2>/dev/null || exit 0)
REMOTE=$(git rev-parse origin/main 2>/dev/null || exit 0)

if [[ "$LOCAL" == "$REMOTE" ]]; then
    exit 0
fi

NOTIFIED=""
if [[ -f "$NOTIFIED_FILE" ]]; then
    NOTIFIED="$(cat "$NOTIFIED_FILE" 2>/dev/null || true)"
fi

if [[ "$NOTIFIED" == "$REMOTE" ]]; then
    exit 0
fi

COUNT=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
COMMITS=$(git log --oneline -5 HEAD..origin/main 2>/dev/null || echo "")

TEXT="<b>Nova atualização disponível!</b>\n\n"
TEXT+="<b>${COUNT}</b> commit(s) novo(s):\n"

while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    HASH="${line%% *}"
    MSG="${line#* }"
    MSG="${MSG//&/&amp;}"
    MSG="${MSG//</&lt;}"
    MSG="${MSG//>/&gt;}"
    TEXT+="• <code>${HASH}</code> ${MSG}\n"
done <<< "$COMMITS"

TEXT+="\nVersão atual: <code>${LOCAL:0:7}</code>"
TEXT+="\nNova versão: <code>${REMOTE:0:7}</code>"

KEYBOARD='{"inline_keyboard":[[{"text":"Atualizar agora","callback_data":"autoupdate:confirm"},{"text":"Ignorar","callback_data":"autoupdate:dismiss"}]]}'

PAYLOAD=$(jq -n \
    --arg chat_id "$ALLOWED_CHAT_ID" \
    --arg text "$(echo -e "$TEXT")" \
    --argjson reply_markup "$KEYBOARD" \
    '{chat_id: ($chat_id | tonumber), text: $text, parse_mode: "HTML", reply_markup: $reply_markup}')

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    >/dev/null 2>&1 || true

echo -n "$REMOTE" > "$NOTIFIED_FILE"
