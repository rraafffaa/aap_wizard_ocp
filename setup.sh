#!/usr/bin/env bash
# AAP Deployment Wizard — Setup & Launch
#
# This script installs all dependencies and launches the desktop app.
#
# Usage:
#   ./setup.sh              # First-time setup + launch
#   ./setup.sh --launch     # Skip setup, just launch
#   ./setup.sh --test       # Run all tests
#
# Prerequisites:
#   - Python 3.10+ (python3)
#   - Node.js 18+ (node, npm)
#   - sshpass (for SSH password auth)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Preflight checks ────────────────────────────────────────────────

check_command() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "${RED}Missing: $1${NC}"
        echo "  $2"
        return 1
    fi
    echo -e "  ${GREEN}✓${NC} $1 $(command -v "$1")"
    return 0
}

preflight() {
    echo -e "${BLUE}Checking prerequisites...${NC}"
    local ok=true

    check_command python3 "Install Python 3.10+: https://www.python.org/downloads/" || ok=false
    check_command node "Install Node.js 18+: https://nodejs.org/" || ok=false
    check_command npm "Comes with Node.js" || ok=false

    # sshpass is needed at runtime, warn but don't block
    if ! command -v sshpass &>/dev/null; then
        echo -e "  ${YELLOW}!${NC} sshpass not found (needed for deployment, not for setup)"
        echo "    Install: brew install sshpass  OR  dnf install sshpass"
    else
        echo -e "  ${GREEN}✓${NC} sshpass"
    fi

    # Check Python version
    PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
    if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]); then
        echo -e "${RED}Python $PY_VER is too old. Need 3.10+${NC}"
        ok=false
    fi

    if [ "$ok" = false ]; then
        echo -e "\n${RED}Fix the issues above and re-run ./setup.sh${NC}"
        exit 1
    fi

    echo -e "${GREEN}All prerequisites met.${NC}\n"
}

# ─── Install dependencies ────────────────────────────────────────────

install_backend() {
    echo -e "${YELLOW}Setting up Python backend...${NC}"
    cd "$SCRIPT_DIR/backend"

    if [ ! -d ".venv" ]; then
        python3 -m venv .venv
    fi

    # Activate venv
    source .venv/bin/activate 2>/dev/null || . .venv/bin/activate

    pip install -q --upgrade pip
    pip install -q -r requirements.txt
    echo -e "${GREEN}Backend dependencies installed.${NC}\n"
    cd "$SCRIPT_DIR"
}

install_frontend() {
    echo -e "${YELLOW}Setting up frontend + Electron...${NC}"
    cd "$SCRIPT_DIR/frontend"
    npm ci --silent 2>/dev/null || npm install --silent
    echo -e "${GREEN}Frontend dependencies installed.${NC}\n"
    cd "$SCRIPT_DIR"
}

# ─── Check AAP tarball ───────────────────────────────────────────────

check_tarball() {
    if [ ! -f "$SCRIPT_DIR/ansible-automation-platform-containerized-setup-2.6-6.tar.gz" ]; then
        echo -e "${RED}AAP setup tarball not found!${NC}"
        echo ""
        echo "The file 'ansible-automation-platform-containerized-setup-2.6-6.tar.gz'"
        echo "should be in the project root. If it was excluded from git:"
        echo ""
        echo "  Download from: https://access.redhat.com/downloads/content/480"
        echo "  Place it in: $SCRIPT_DIR/"
        echo ""
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} AAP setup tarball found"
}

# ─── Test ─────────────────────────────────────────────────────────────

run_tests() {
    echo -e "${BLUE}Running backend tests...${NC}"
    cd "$SCRIPT_DIR/backend"
    source .venv/bin/activate 2>/dev/null || . .venv/bin/activate
    pip install -q pytest httpx 2>/dev/null
    python -m pytest tests/ -v --tb=short
    BACKEND_RESULT=$?
    cd "$SCRIPT_DIR"

    echo ""
    echo -e "${BLUE}Running frontend tests...${NC}"
    cd "$SCRIPT_DIR/frontend"
    npm run test
    FRONTEND_RESULT=$?
    cd "$SCRIPT_DIR"

    echo ""
    if [ $BACKEND_RESULT -eq 0 ] && [ $FRONTEND_RESULT -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
    else
        echo -e "${RED}Some tests failed.${NC}"
        exit 1
    fi
}

# ─── Launch ───────────────────────────────────────────────────────────

launch() {
    echo -e "${BLUE}Launching AAP Deployment Wizard...${NC}\n"
    cd "$SCRIPT_DIR/frontend"
    npm run electron:dev
}

# ─── Main ─────────────────────────────────────────────────────────────

case "${1:-}" in
    --launch)
        launch
        ;;
    --test)
        preflight
        install_backend
        install_frontend
        run_tests
        ;;
    *)
        echo ""
        echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║   AAP Deployment Wizard — Setup       ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
        echo ""
        preflight
        check_tarball
        install_backend
        install_frontend
        echo -e "${GREEN}Setup complete!${NC}\n"
        launch
        ;;
esac
