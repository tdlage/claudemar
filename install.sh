#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/claudemar"
DATA_DIR="$HOME/.claudemar"
REPO_URL="https://github.com/tdlage/claudemar.git"
SERVICE_NAME="claudemar"
NODE_MAJOR=22

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

IS_UPDATE=false
NODE_INSTALLED=false
CLAUDE_FOUND=false
ENV_CREATED=false
SERVICE_INSTALLED=false
CRON_INSTALLED=false
OS=""
DISTRO=""
NODE_BIN_DIR=""
CLAUDE_BIN_DIR=""
TOTAL_STEPS=9

info()    { echo -e "${BLUE}ℹ${NC} $*"; }
success() { echo -e "${GREEN}✔${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✖${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}[$1/$TOTAL_STEPS] $2${NC}"; }

detect_os() {
    local uname_out
    uname_out="$(uname -s)"

    case "$uname_out" in
        Linux)
            OS="linux"
            if [[ -f /etc/os-release ]]; then
                # shellcheck disable=SC1091
                source /etc/os-release
                case "${ID:-}" in
                    debian)       DISTRO="debian" ;;
                    ubuntu)       DISTRO="ubuntu" ;;
                    rhel|centos|fedora|amzn) DISTRO="rhel" ;;
                    *)            DISTRO="unknown"; warn "Distro '${ID:-}' not explicitly supported, will attempt Debian-style install" ;;
                esac
            else
                DISTRO="unknown"
                warn "Cannot detect Linux distro, will attempt Debian-style install"
            fi
            ;;
        Darwin)
            OS="darwin"
            DISTRO="macos"
            ;;
        *)
            error "Unsupported OS: $uname_out. Only Linux and macOS are supported."
            ;;
    esac

    info "Detected OS: ${OS} (${DISTRO})"

    if [[ $EUID -eq 0 ]]; then
        warn "Running as root. The service will run as root — consider using a non-root user."
    fi
}

preflight_checks() {
    step 1 "Preflight checks"

    if ! command -v git &>/dev/null; then
        if [[ "$OS" == "darwin" ]]; then
            error "git is not installed. Run: xcode-select --install"
        elif [[ "$DISTRO" == "rhel" ]]; then
            error "git is not installed. Run: sudo yum install -y git"
        else
            error "git is not installed. Run: sudo apt-get install -y git"
        fi
    fi
    success "git found: $(git --version)"

    if ! command -v curl &>/dev/null; then
        if [[ "$OS" == "darwin" ]]; then
            error "curl is not installed. Run: brew install curl"
        elif [[ "$DISTRO" == "rhel" ]]; then
            error "curl is not installed. Run: sudo yum install -y curl"
        else
            error "curl is not installed. Run: sudo apt-get install -y curl"
        fi
    fi
    success "curl found: $(curl --version | head -1)"
}

resolve_node_path() {
    NODE_BIN_DIR="$(dirname "$(command -v node)")"
}

ensure_node() {
    step 2 "Ensuring Node.js >= $NODE_MAJOR"

    if command -v node &>/dev/null; then
        local current_major
        current_major="$(node -v | sed 's/v//' | cut -d. -f1)"
        if [[ "$current_major" -ge "$NODE_MAJOR" ]]; then
            success "Node.js $(node -v) already installed"
            resolve_node_path
            return
        fi
        warn "Node.js $(node -v) is too old (need >= $NODE_MAJOR)"
    fi

    if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
        info "NVM detected, installing Node.js $NODE_MAJOR via nvm..."
        # shellcheck disable=SC1091
        source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
        nvm install "$NODE_MAJOR"
        nvm use "$NODE_MAJOR"
        NODE_INSTALLED=true
        warn "Node installed via NVM. Switching Node versions will break the systemd service."
    elif [[ "$OS" == "linux" ]]; then
        if [[ "$DISTRO" == "rhel" ]]; then
            info "Installing Node.js $NODE_MAJOR via NodeSource (RPM)..."
            curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
            sudo yum install -y nodejs
        else
            info "Installing Node.js $NODE_MAJOR via NodeSource (DEB)..."
            curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
            sudo apt-get install -y nodejs
        fi
        NODE_INSTALLED=true
    elif [[ "$OS" == "darwin" ]]; then
        if command -v brew &>/dev/null; then
            info "Installing Node.js $NODE_MAJOR via Homebrew..."
            brew install "node@$NODE_MAJOR"
            brew link --overwrite "node@$NODE_MAJOR"
            NODE_INSTALLED=true
        else
            error "Node.js >= $NODE_MAJOR not found and Homebrew is not installed.\nInstall Node.js manually: https://nodejs.org/en/download/"
        fi
    fi

    if ! command -v node &>/dev/null; then
        error "Node.js installation failed. Install manually: https://nodejs.org/en/download/"
    fi

    if ! command -v npm &>/dev/null; then
        error "npm not found after Node.js installation."
    fi

    resolve_node_path
    success "Node.js $(node -v) ready (npm $(npm -v))"
}

check_claude() {
    step 3 "Checking Claude CLI"

    if command -v claude &>/dev/null; then
        CLAUDE_FOUND=true
        CLAUDE_BIN_DIR="$(dirname "$(command -v claude)")"
        success "Claude CLI found: $(command -v claude)"
    else
        CLAUDE_FOUND=false
        warn "Claude CLI not found. Claudemar requires it to function."
        info "Install: npm install -g @anthropic-ai/claude-code"
        info "Then authenticate: claude auth"
    fi
}

setup_repo() {
    step 4 "Setting up repository"

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        info "Updating repository..."
        cd "$INSTALL_DIR"
        git fetch origin
        if ! git pull --ff-only origin main 2>/dev/null; then
            warn "Local changes detected, cannot fast-forward."
            if [[ -t 0 ]]; then
                read -rp "Reset to origin/main? Local changes will be LOST. [y/N]: " confirm
                if [[ "$confirm" =~ ^[Yy]$ ]]; then
                    git reset --hard origin/main
                else
                    error "Update aborted. Resolve manually in $INSTALL_DIR"
                fi
            else
                git reset --hard origin/main
                warn "Non-interactive mode: forced reset to origin/main"
            fi
        fi
        success "Repository updated to latest"
    elif [[ -d "$INSTALL_DIR" ]]; then
        error "$INSTALL_DIR exists but is not a git repository. Please rename or remove it."
    else
        info "Cloning repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        success "Repository cloned to $INSTALL_DIR"
    fi
}

build_project() {
    step 5 "Building project"

    cd "$INSTALL_DIR"
    info "Installing dependencies..."
    npm ci

    if [[ -d "$INSTALL_DIR/dashboard" ]]; then
        info "Installing dashboard dependencies..."
        cd "$INSTALL_DIR/dashboard"
        npm ci
        cd "$INSTALL_DIR"
    fi

    info "Building project..."
    npm run build:all

    if [[ ! -f "$INSTALL_DIR/dist/main.js" ]]; then
        error "Build failed: dist/main.js not found"
    fi

    if [[ ! -f "$INSTALL_DIR/dashboard/dist/index.html" ]]; then
        warn "Dashboard build not found — web UI will not be available"
    else
        success "Dashboard built"
    fi

    success "Build complete"
}

register_bot_commands() {
    local token="$1"
    info "Registering bot commands in Telegram..."

    local commands='{"commands":[
        {"command":"project","description":"Gerenciar projetos (add/remove/selecionar)"},
        {"command":"repository","description":"Gerenciar repositórios do projeto ativo"},
        {"command":"agent","description":"Listar/criar/remover agentes"},
        {"command":"mode","description":"Alternar entre projects/agents"},
        {"command":"delegate","description":"Execução one-shot em agente"},
        {"command":"inbox","description":"Mensagens pendentes do agente"},
        {"command":"status","description":"Dashboard de agentes"},
        {"command":"broadcast","description":"Mensagem para todos os agentes"},
        {"command":"council","description":"Reunião multi-agente"},
        {"command":"schedule","description":"Agendar tarefa"},
        {"command":"metrics","description":"Métricas de uso"},
        {"command":"running","description":"Execuções em andamento"},
        {"command":"stream","description":"Acompanhar saída em tempo real"},
        {"command":"stop_stream","description":"Parar stream ativo"},
        {"command":"history","description":"Histórico de execuções"},
        {"command":"current","description":"Modo, projeto/agente e sessão"},
        {"command":"reset","description":"Resetar sessão do contexto atual"},
        {"command":"clear","description":"Resetar tudo"},
        {"command":"cancel","description":"Cancelar execução"},
        {"command":"queue","description":"Ver fila de comandos"},
        {"command":"queue_remove","description":"Remover item da fila"},
        {"command":"update","description":"Verificar e aplicar atualizações"},
        {"command":"token","description":"Token atual do dashboard"},
        {"command":"help","description":"Lista de comandos"}
    ]}'

    local response
    response=$(curl -s -X POST "https://api.telegram.org/bot${token}/setMyCommands" \
        -H "Content-Type: application/json" \
        -d "$commands" 2>/dev/null)

    if echo "$response" | grep -q '"ok":true'; then
        success "Bot commands registered (autocomplete will show Claudemar commands)"
    else
        warn "Could not register bot commands. You can do it manually via @BotFather /setcommands"
    fi
}

auto_detect_chat_id() {
    local token="$1"
    local response
    response=$(curl -s "https://api.telegram.org/bot${token}/getUpdates?limit=5" 2>/dev/null)

    if ! echo "$response" | grep -q '"ok":true'; then
        return 1
    fi

    local chat_id
    chat_id=$(echo "$response" | grep -oP '"chat":\{"id":\K[0-9-]+' | head -1)
    if [[ -n "$chat_id" ]]; then
        echo "$chat_id"
        return 0
    fi
    return 1
}

setup_env() {
    step 6 "Configuring environment"

    mkdir -p "$DATA_DIR"
    success "Data directory: $DATA_DIR"

    local env_file="$INSTALL_DIR/.env"

    if [[ -f "$env_file" ]]; then
        info ".env already exists, preserving"

        local existing_token
        existing_token="$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.+' "$env_file" 2>/dev/null || true)"
        if [[ -z "$existing_token" ]]; then
            warn "TELEGRAM_BOT_TOKEN is empty — bot won't start until configured"
        else
            register_bot_commands "$existing_token"
        fi

        if grep -q '^CLAUDE_TIMEOUT_MS=' "$env_file" 2>/dev/null; then
            local current_timeout
            current_timeout="$(grep -oP '^CLAUDE_TIMEOUT_MS=\K.*' "$env_file" 2>/dev/null || true)"
            if [[ "$current_timeout" != "0" && -n "$current_timeout" ]]; then
                info "Removing timeout (CLAUDE_TIMEOUT_MS=${current_timeout} -> 0). Claude Code should not have a timeout."
                sed -i "s/^CLAUDE_TIMEOUT_MS=.*/CLAUDE_TIMEOUT_MS=0/" "$env_file"
            fi
        fi

        if ! grep -q '^CLAUDEMAR_DATA=' "$env_file" 2>/dev/null; then
            printf 'CLAUDEMAR_DATA=%s\n' "$DATA_DIR" >> "$env_file"
            info "Added CLAUDEMAR_DATA=$DATA_DIR to .env"
        fi
        return
    fi

    if [[ -t 0 ]]; then
        local token="" chat_id="" openai_key="" dashboard_token="" dashboard_port=""

        echo ""
        echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║              Telegram Bot Configuration                      ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  Claudemar uses a Telegram bot to receive and process messages."
        echo -e "  You need to create a bot and get its token. Here's how:"
        echo ""
        echo -e "  ${BOLD}Step 1:${NC} Open Telegram and search for ${BOLD}@BotFather${NC}"
        echo -e "  ${BOLD}Step 2:${NC} Send ${BOLD}/newbot${NC} to BotFather"
        echo -e "  ${BOLD}Step 3:${NC} Choose a ${BOLD}name${NC} for your bot (display name, can have spaces)"
        echo -e "  ${BOLD}Step 4:${NC} Choose a ${BOLD}username${NC} (must end with 'bot', e.g. my_claude_bot)"
        echo -e "  ${BOLD}Step 5:${NC} BotFather will reply with your ${BOLD}HTTP API token${NC}"
        echo -e "         It looks like: ${YELLOW}123456789:ABCdefGHIjklMNOpqrSTUvwxYZ${NC}"
        echo ""
        echo -e "  ${BLUE}You can do this now or skip to configure later in .env${NC}"
        echo ""
        read -rp "$(echo -e "${BOLD}Telegram Bot Token${NC} (Enter to skip): ")" token

        if [[ -n "$token" ]]; then
            success "Token set"

            echo ""
            echo -e "  ${BOLD}Now let's get your Chat ID${NC} so only you can use the bot."
            echo ""
            echo -e "  ${BOLD}Step 1:${NC} Open Telegram and send ${BOLD}any message${NC} to your new bot"
            echo -e "         (just say \"hi\" — this registers your chat)"
            echo ""
            echo -e "  ${YELLOW}>>> Send a message to your bot now, then press Enter here <<<${NC}"
            read -rp "" _wait

            local detected_id
            if detected_id=$(auto_detect_chat_id "$token"); then
                echo ""
                success "Chat ID detected automatically: ${BOLD}${detected_id}${NC}"
                read -rp "$(echo -e "  Use this ID? [Y/n]: ")" use_detected
                if [[ ! "$use_detected" =~ ^[Nn]$ ]]; then
                    chat_id="$detected_id"
                fi
            else
                echo ""
                warn "Could not detect Chat ID automatically."
                echo -e "  Make sure you sent a message to the bot and try again,"
                echo -e "  or enter it manually."
                echo ""
                echo -e "  ${BOLD}To find manually:${NC}"
                echo -e "  Open: ${BOLD}https://api.telegram.org/bot${token}/getUpdates${NC}"
                echo -e "  Look for ${BOLD}\"chat\":{\"id\":YOUR_NUMBER}${NC} in the JSON response"
            fi

            if [[ -z "$chat_id" ]]; then
                echo ""
                read -rp "$(echo -e "${BOLD}Chat ID${NC} (Enter to skip): ")" chat_id
            fi

            if [[ -n "$chat_id" ]]; then
                success "Chat ID set: $chat_id"
            else
                warn "Chat ID not set — bot will reject all messages until configured"
            fi
        else
            warn "Telegram not configured — you'll need to edit .env later"
        fi

        echo ""
        echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║              Voice Messages (Optional)                       ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  An OpenAI API key enables ${BOLD}voice message transcription${NC} via Whisper."
        echo -e "  You can send voice messages to the bot and they'll be transcribed"
        echo -e "  and processed as text commands."
        echo ""
        echo -e "  Get your key at: ${BOLD}https://platform.openai.com/api-keys${NC}"
        echo ""
        read -rp "$(echo -e "${BOLD}OpenAI API Key${NC} (Enter to skip): ")" openai_key

        if [[ -n "$openai_key" ]]; then
            success "OpenAI key set"
        else
            info "Skipped — voice messages won't be transcribed"
        fi

        echo ""
        echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║              Web Dashboard                                   ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  The web dashboard lets you manage projects, agents, and executions"
        echo -e "  from a browser with a terminal, file editor, and more."
        echo ""
        echo -e "  ${BOLD}Authentication:${NC} A rotating token is generated on each startup."
        echo -e "  Use ${BOLD}/token${NC} in Telegram to get the current access token."
        echo ""
        echo -e "  You can optionally set a ${BOLD}master token${NC} as a permanent fallback"
        echo -e "  (useful for bookmarks/scripts). Leave empty for rotating only."
        echo ""
        read -rp "$(echo -e "${BOLD}Dashboard Master Token${NC} (Enter to skip): ")" dashboard_token
        read -rp "$(echo -e "${BOLD}Dashboard Port${NC} [3000]: ")" dashboard_port

        if [[ -n "$dashboard_token" ]]; then
            success "Master token set"
        else
            info "Using rotating tokens only (get via /token in Telegram)"
        fi

        printf 'TELEGRAM_BOT_TOKEN=%s\n' "$token" > "$env_file"
        printf 'ALLOWED_CHAT_ID=%s\n' "$chat_id" >> "$env_file"
        printf 'OPENAI_API_KEY=%s\n' "$openai_key" >> "$env_file"
        printf 'CLAUDE_TIMEOUT_MS=0\n' >> "$env_file"
        printf 'MAX_OUTPUT_LENGTH=4096\n' >> "$env_file"
        printf 'DASHBOARD_TOKEN=%s\n' "$dashboard_token" >> "$env_file"
        printf 'DASHBOARD_PORT=%s\n' "${dashboard_port:-3000}" >> "$env_file"
        printf 'CLAUDEMAR_DATA=%s\n' "$DATA_DIR" >> "$env_file"
        ENV_CREATED=true

        if [[ -n "$token" ]]; then
            register_bot_commands "$token"
        fi
    else
        cat > "$env_file" <<EOF
TELEGRAM_BOT_TOKEN=
ALLOWED_CHAT_ID=
OPENAI_API_KEY=
CLAUDE_TIMEOUT_MS=0
MAX_OUTPUT_LENGTH=4096
DASHBOARD_TOKEN=
DASHBOARD_PORT=3000
CLAUDEMAR_DATA=${DATA_DIR}
EOF
        ENV_CREATED=true
        warn "Non-interactive mode: .env created with empty values"
        warn "Edit $env_file with your credentials before starting"
    fi

    chmod 600 "$env_file"
    success ".env configured (permissions: 600)"
}

setup_cron() {
    step 7 "Setting up cron jobs"

    if ! command -v crontab &>/dev/null; then
        warn "crontab not found — skipping cron setup"
        return
    fi

    local existing
    existing="$(crontab -l 2>/dev/null || true)"
    local filtered
    filtered="$(echo "$existing" | grep -v "check-update.sh" | grep -v "sync-agents.sh" | sed '/^$/d' || true)"

    local entries=""

    local update_script="$INSTALL_DIR/scripts/check-update.sh"
    if [[ -f "$update_script" ]]; then
        chmod +x "$update_script"
        entries+="*/10 * * * * CLAUDEMAR_DIR=$INSTALL_DIR CLAUDEMAR_DATA=$DATA_DIR $update_script >/dev/null 2>&1"$'\n'
        success "Auto-update cron configured (every 10 minutes)"
    else
        warn "check-update.sh not found — skipping auto-update cron"
    fi

    local sync_script="$INSTALL_DIR/scripts/sync-agents.sh"
    if [[ -f "$sync_script" ]]; then
        chmod +x "$sync_script"
        entries+="*/10 * * * * CLAUDEMAR_DIR=$INSTALL_DIR CLAUDEMAR_DATA=$DATA_DIR $sync_script >/dev/null 2>&1"$'\n'
        success "Agent sync cron configured (every 10 minutes)"
    else
        warn "sync-agents.sh not found — skipping agent sync cron"
    fi

    if [[ -z "$entries" ]]; then
        return
    fi

    entries="${entries%$'\n'}"

    if [[ -n "$filtered" ]]; then
        printf '%s\n%s\n' "$filtered" "$entries" | crontab -
    else
        echo "$entries" | crontab -
    fi

    CRON_INSTALLED=true
}

setup_nginx_sudoers() {
    step 8 "Configuring nginx proxy permissions"

    if [[ "$OS" != "linux" ]]; then
        info "Skipping nginx sudoers setup (not Linux)"
        return
    fi

    if ! command -v nginx &>/dev/null; then
        warn "nginx not found — skipping sudoers setup"
        info "Install nginx and re-run the installer to enable reverse proxy"
        return
    fi

    local service_user
    if [[ $EUID -eq 0 ]]; then
        info "Running as root — nginx proxy permissions not needed"
        return
    fi
    service_user="$(whoami)"

    local sudoers_file="/etc/sudoers.d/claudemar"
    local sudoers_content
    sudoers_content="$(cat <<SUDOERS
${service_user} ALL=(root) NOPASSWD: /usr/bin/tee /etc/nginx/conf.d/claudemar-proxies.conf
${service_user} ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
${service_user} ALL=(root) NOPASSWD: /usr/bin/systemctl restart claudemar
${service_user} ALL=(root) NOPASSWD: /usr/bin/tee /etc/sudoers.d/claudemar
${service_user} ALL=(root) NOPASSWD: /bin/chmod 0440 /etc/sudoers.d/claudemar
SUDOERS
)"

    if [[ -f "$sudoers_file" ]]; then
        local existing
        existing="$(sudo cat "$sudoers_file" 2>/dev/null || true)"
        if [[ "$existing" == "$sudoers_content" ]]; then
            success "Sudoers already configured for nginx proxy"
            return
        fi
    fi

    echo "$sudoers_content" | sudo tee "$sudoers_file" > /dev/null
    sudo chmod 0440 "$sudoers_file"

    if sudo visudo -cf "$sudoers_file" &>/dev/null; then
        success "Sudoers configured: ${service_user} can write nginx config and reload"
    else
        sudo rm -f "$sudoers_file"
        error "Invalid sudoers file generated — removed. Please check manually."
    fi

    sudo mkdir -p /etc/nginx/conf.d
    success "nginx conf.d directory ensured"
}

setup_systemd() {
    step 9 "Setting up systemd service"

    if ! command -v systemctl &>/dev/null; then
        warn "systemctl not found — skipping service setup"
        info "Run manually: cd $INSTALL_DIR && node dist/main.js"
        return
    fi

    local service_path="/etc/systemd/system/${SERVICE_NAME}.service"
    local node_bin
    node_bin="$(command -v node)"

    local path_entries="$NODE_BIN_DIR"
    if [[ "$CLAUDE_FOUND" == true && -n "$CLAUDE_BIN_DIR" ]]; then
        path_entries="${path_entries}:${CLAUDE_BIN_DIR}"
    fi
    path_entries="${path_entries}:/usr/local/bin:/usr/bin:/bin"

    local service_user
    if [[ $EUID -eq 0 ]]; then
        service_user="root"
    else
        service_user="$(whoami)"
    fi

    sudo tee "$service_path" > /dev/null <<EOF
[Unit]
Description=Claudemar — Telegram Bot for Claude CLI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${node_bin} ${INSTALL_DIR}/dist/main.js
Restart=on-failure
RestartSec=10
EnvironmentFile=${INSTALL_DIR}/.env
Environment=PATH=${path_entries}
Environment=HOME=${HOME}

ReadWritePaths=${INSTALL_DIR}
ReadWritePaths=${DATA_DIR}

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        info "Service already running, restarting..."
        sudo systemctl restart "$SERVICE_NAME"
    else
        sudo systemctl enable "$SERVICE_NAME"
        sudo systemctl start "$SERVICE_NAME"
    fi

    SERVICE_INSTALLED=true

    local started=false
    for _ in {1..5}; do
        sleep 1
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            started=true
            break
        fi
    done

    if [[ "$started" == true ]]; then
        success "Service is running"
    else
        warn "Service may still be starting — check: sudo journalctl -u $SERVICE_NAME -n 30"
    fi
}

macos_instructions() {
    step 9 "Run instructions (macOS)"

    echo ""
    info "macOS detected — no systemd available"
    echo ""
    echo -e "  ${BOLD}Run manually:${NC}"
    echo -e "    cd $INSTALL_DIR && node dist/main.js"
    echo ""
    echo -e "  ${BOLD}Dashboard:${NC}"
    echo -e "    Open http://localhost:\${DASHBOARD_PORT:-3000} in your browser"
    echo ""
    echo -e "  ${BOLD}Or use pm2 for background:${NC}"
    echo -e "    npm install -g pm2"
    echo -e "    cd $INSTALL_DIR && pm2 start dist/main.js --name claudemar"
    echo -e "    pm2 save && pm2 startup"
    echo ""
}

print_summary() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║         Claudemar Install Summary        ║${NC}"
    echo -e "${BOLD}╠══════════════════════════════════════════╣${NC}"

    if [[ "$IS_UPDATE" == true ]]; then
        echo -e "${BOLD}║${NC}  Mode:      ${BLUE}Update${NC}"
    else
        echo -e "${BOLD}║${NC}  Mode:      ${GREEN}Fresh install${NC}"
    fi

    echo -e "${BOLD}║${NC}  Code:      ${INSTALL_DIR}"
    echo -e "${BOLD}║${NC}  Data:      ${DATA_DIR}"
    echo -e "${BOLD}║${NC}  Node:      $(node -v)"

    if [[ "$CLAUDE_FOUND" == true ]]; then
        echo -e "${BOLD}║${NC}  Claude:    ${GREEN}found${NC}"
    else
        echo -e "${BOLD}║${NC}  Claude:    ${YELLOW}not found${NC}"
    fi

    if [[ -f "$INSTALL_DIR/.env" ]]; then
        if grep -qE '^TELEGRAM_BOT_TOKEN=\s*"?\s*"?\s*$' "$INSTALL_DIR/.env" 2>/dev/null; then
            echo -e "${BOLD}║${NC}  .env:      ${YELLOW}needs configuration${NC}"
        else
            echo -e "${BOLD}║${NC}  .env:      ${GREEN}configured${NC}"
        fi
    fi

    if [[ "$SERVICE_INSTALLED" == true ]]; then
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "${BOLD}║${NC}  Service:   ${GREEN}active${NC}"
        else
            echo -e "${BOLD}║${NC}  Service:   ${YELLOW}installed but not running${NC}"
        fi
    elif [[ "$OS" == "darwin" ]]; then
        echo -e "${BOLD}║${NC}  Service:   ${BLUE}manual (macOS)${NC}"
    else
        echo -e "${BOLD}║${NC}  Service:   ${YELLOW}skipped${NC}"
    fi

    if [[ "$CRON_INSTALLED" == true ]]; then
        echo -e "${BOLD}║${NC}  AutoUpdate: ${GREEN}cron every 10m${NC}"
    else
        echo -e "${BOLD}║${NC}  AutoUpdate: ${YELLOW}skipped${NC}"
    fi

    if [[ -f "$INSTALL_DIR/dashboard/dist/index.html" ]]; then
        local dash_port
        dash_port="$(grep -oP '^DASHBOARD_PORT=\K.*' "$INSTALL_DIR/.env" 2>/dev/null || echo "3000")"
        dash_port="${dash_port:-3000}"
        echo -e "${BOLD}║${NC}  Dashboard: ${GREEN}http://localhost:${dash_port}${NC}"
    else
        echo -e "${BOLD}║${NC}  Dashboard: ${YELLOW}not built${NC}"
    fi

    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"

    local has_next_steps=false

    if grep -qE '^TELEGRAM_BOT_TOKEN=\s*"?\s*"?\s*$' "$INSTALL_DIR/.env" 2>/dev/null; then
        if [[ "$has_next_steps" == false ]]; then
            echo ""
            echo -e "${BOLD}Next steps:${NC}"
            has_next_steps=true
        fi
        echo -e "  1. Edit ${INSTALL_DIR}/.env with your Telegram credentials"
        if [[ "$SERVICE_INSTALLED" == true ]]; then
            echo -e "  2. Restart: sudo systemctl restart $SERVICE_NAME"
        fi
    fi

    if [[ "$CLAUDE_FOUND" == false ]]; then
        if [[ "$has_next_steps" == false ]]; then
            echo ""
            echo -e "${BOLD}Next steps:${NC}"
            has_next_steps=true
        fi
        echo -e "  • Install Claude CLI: npm install -g @anthropic-ai/claude-code"
        echo -e "  • Authenticate: claude auth"
    fi

    echo ""
    echo -e "${BOLD}Useful commands:${NC}"
    if [[ "$SERVICE_INSTALLED" == true ]]; then
        echo -e "  sudo systemctl status $SERVICE_NAME"
        echo -e "  sudo journalctl -u $SERVICE_NAME -f"
        echo -e "  sudo systemctl restart $SERVICE_NAME"
    fi
    echo -e "  cd $INSTALL_DIR && node dist/main.js      # run manually"
    echo -e "  cd $INSTALL_DIR && docker compose up -d    # run via Docker"

    echo ""
}

check_existing_installation() {
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        local current_commit current_date
        current_commit="$(cd "$INSTALL_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
        current_date="$(cd "$INSTALL_DIR" && git log -1 --format=%ci 2>/dev/null | cut -d' ' -f1 || echo "unknown")"

        echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║              Existing Installation Detected                   ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  Claudemar is already installed at: ${BOLD}${INSTALL_DIR}${NC}"
        echo -e "  Current version: ${BOLD}${current_commit}${NC} (${current_date})"

        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "  Service status:  ${GREEN}running${NC}"
        elif systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "  Service status:  ${YELLOW}stopped${NC}"
        fi

        echo ""

        if [[ -t 0 ]]; then
            echo -e "  ${BOLD}[U]${NC} Update to latest version"
            echo -e "  ${BOLD}[R]${NC} Reinstall from scratch (keeps .env)"
            echo -e "  ${BOLD}[Q]${NC} Quit"
            echo ""
            read -rp "$(echo -e "  ${BOLD}Choice${NC} [U/r/q]: ")" choice
            choice="${choice:-U}"

            case "$choice" in
                [Uu])
                    IS_UPDATE=true
                    info "Proceeding with update..."
                    ;;
                [Rr])
                    IS_UPDATE=false
                    info "Proceeding with reinstall (preserving .env)..."
                    ;;
                [Qq])
                    echo ""
                    info "Installation cancelled."
                    exit 0
                    ;;
                *)
                    IS_UPDATE=true
                    info "Proceeding with update..."
                    ;;
            esac
        else
            IS_UPDATE=true
            info "Non-interactive mode: proceeding with update"
        fi

        echo ""
        return 0
    fi

    return 1
}

main() {
    echo ""
    echo -e "${BOLD}🤖 Claudemar Installer${NC}"
    echo ""

    check_existing_installation

    detect_os
    preflight_checks
    ensure_node
    check_claude
    setup_repo
    build_project
    setup_env
    setup_cron

    setup_nginx_sudoers

    if [[ "$OS" == "linux" ]]; then
        setup_systemd
    else
        macos_instructions
    fi

    print_summary
}

main "$@"
