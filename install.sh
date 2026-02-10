#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/claudemar"
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
OS=""
DISTRO=""
NODE_BIN_DIR=""
CLAUDE_BIN_DIR=""
TOTAL_STEPS=7

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

    if [[ -d "$INSTALL_DIR" ]]; then
        if [[ -d "$INSTALL_DIR/.git" ]]; then
            IS_UPDATE=true
            info "Existing installation found, updating..."
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
        else
            error "$INSTALL_DIR exists but is not a git repository. Please rename or remove it."
        fi
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
        {"command":"project","description":"Selecionar projeto ativo"},
        {"command":"add","description":"Clonar repositório"},
        {"command":"remove","description":"Remover projeto"},
        {"command":"agent","description":"Listar/criar/remover agentes"},
        {"command":"mode","description":"Alternar entre projects/agents"},
        {"command":"delegate","description":"Execução one-shot em agente"},
        {"command":"inbox","description":"Mensagens pendentes do agente"},
        {"command":"status","description":"Dashboard de agentes"},
        {"command":"broadcast","description":"Mensagem para todos os agentes"},
        {"command":"council","description":"Reunião multi-agente"},
        {"command":"schedule","description":"Agendar tarefa"},
        {"command":"metrics","description":"Métricas de uso"},
        {"command":"current","description":"Modo, projeto/agente e sessão"},
        {"command":"clear","description":"Resetar tudo"},
        {"command":"cancel","description":"Cancelar execução"},
        {"command":"exec","description":"Executar comando shell"},
        {"command":"git","description":"Executar comando git"},
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

setup_env() {
    step 6 "Configuring environment"

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
        return
    fi

    if [[ -t 0 ]]; then
        echo ""
        echo -e "${BOLD}━━━ Telegram Bot Setup ━━━${NC}"
        echo ""
        echo -e "  To create your Telegram bot:"
        echo -e "  1. Open Telegram and search for ${BOLD}@BotFather${NC}"
        echo -e "  2. Send ${BOLD}/newbot${NC} and follow the prompts"
        echo -e "  3. Copy the ${BOLD}HTTP API token${NC} BotFather gives you"
        echo ""
        read -rp "$(echo -e "${BOLD}Telegram Bot Token${NC}: ")" token

        echo ""
        echo -e "  To find your Chat ID:"
        echo -e "  1. Send any message to your new bot"
        echo -e "  2. Open: ${BOLD}https://api.telegram.org/bot<TOKEN>/getUpdates${NC}"
        echo -e "  3. Look for ${BOLD}\"chat\":{\"id\":YOUR_NUMBER}${NC} in the response"
        echo -e "  (or start the bot and check the logs)"
        echo ""
        read -rp "$(echo -e "${BOLD}Allowed Chat ID${NC}: ")" chat_id

        echo ""
        echo -e "${BOLD}━━━ Optional Services ━━━${NC}"
        echo ""
        echo -e "  OpenAI API key enables voice message transcription (Whisper)."
        echo -e "  Leave empty to skip."
        echo ""
        read -rp "$(echo -e "${BOLD}OpenAI API Key${NC} (optional): ")" openai_key

        echo ""
        echo -e "${BOLD}━━━ Dashboard Configuration ━━━${NC}"
        echo ""
        echo -e "  The web dashboard lets you manage agents, projects, and executions."
        echo -e "  Set a ${BOLD}token${NC} to enable remote access (binds to 0.0.0.0)."
        echo -e "  Leave empty for localhost-only access (no auth needed)."
        echo ""
        read -rp "$(echo -e "${BOLD}Dashboard Token${NC}: ")" dashboard_token

        local dashboard_port=""
        read -rp "$(echo -e "${BOLD}Dashboard Port${NC} (default: 3000): ")" dashboard_port

        printf 'TELEGRAM_BOT_TOKEN=%s\n' "$token" > "$env_file"
        printf 'ALLOWED_CHAT_ID=%s\n' "$chat_id" >> "$env_file"
        printf 'OPENAI_API_KEY=%s\n' "$openai_key" >> "$env_file"
        printf 'CLAUDE_TIMEOUT_MS=300000\n' >> "$env_file"
        printf 'MAX_OUTPUT_LENGTH=4096\n' >> "$env_file"
        printf 'DASHBOARD_TOKEN=%s\n' "$dashboard_token" >> "$env_file"
        printf 'DASHBOARD_PORT=%s\n' "${dashboard_port:-3000}" >> "$env_file"
        ENV_CREATED=true

        if [[ -z "$token" ]]; then
            warn "TELEGRAM_BOT_TOKEN left empty — bot won't start until configured"
        else
            register_bot_commands "$token"
        fi
    else
        cat > "$env_file" <<EOF
TELEGRAM_BOT_TOKEN=
ALLOWED_CHAT_ID=
OPENAI_API_KEY=
CLAUDE_TIMEOUT_MS=300000
MAX_OUTPUT_LENGTH=4096
DASHBOARD_TOKEN=
DASHBOARD_PORT=3000
EOF
        ENV_CREATED=true
        warn "Non-interactive mode: .env created with empty values"
        warn "Edit $env_file with your credentials before starting"
    fi

    chmod 600 "$env_file"
    success ".env configured (permissions: 600)"
}

setup_systemd() {
    step 7 "Setting up systemd service"

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
    step 7 "Run instructions (macOS)"

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

    echo -e "${BOLD}║${NC}  Directory: ${INSTALL_DIR}"
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

main() {
    echo ""
    echo -e "${BOLD}🤖 Claudemar Installer${NC}"
    echo ""

    detect_os
    preflight_checks
    ensure_node
    check_claude
    setup_repo
    build_project
    setup_env

    if [[ "$OS" == "linux" ]]; then
        setup_systemd
    else
        macos_instructions
    fi

    print_summary
}

main "$@"
