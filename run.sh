#!/usr/bin/env bash
# AAP Deployment Wizard — One-Command Startup
#
# Usage:
#   ./run.sh                    # Build and run with Docker
#   ./run.sh --dev              # Run in development mode (no Docker)
#   ./run.sh --stop             # Stop the running container
#   ./run.sh --test             # Run backend tests
#
# Prerequisites:
#   - Docker (or Podman) installed
#   - Port 443 available
#
# The wizard will be available at: https://localhost
# Accept the self-signed certificate warning in your browser.

set -e

APP_NAME="aap-wizard"
IMAGE_NAME="aap-wizard:latest"
PORT=443

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Detect container runtime
if command -v docker &>/dev/null; then
    RUNTIME="docker"
elif command -v podman &>/dev/null; then
    RUNTIME="podman"
else
    echo -e "${RED}Error: Docker or Podman is required but not found.${NC}"
    echo "Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

echo -e "${GREEN}Using container runtime: ${RUNTIME}${NC}"

# Load .env if it exists
if [ -f .env ]; then
    echo -e "${GREEN}Loading .env file...${NC}"
    set -a; source .env; set +a
fi

# Set defaults
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
TLS_CN="${TLS_CN:-localhost}"
CORS_ORIGINS="${CORS_ORIGINS:-https://localhost}"

case "${1:-}" in
    --stop)
        echo -e "${YELLOW}Stopping ${APP_NAME}...${NC}"
        $RUNTIME stop $APP_NAME 2>/dev/null || true
        $RUNTIME rm $APP_NAME 2>/dev/null || true
        echo -e "${GREEN}Stopped.${NC}"
        exit 0
        ;;

    --test)
        echo -e "${YELLOW}Running backend tests...${NC}"
        cd backend
        python3 -m venv .venv 2>/dev/null || true
        source .venv/bin/activate 2>/dev/null || . .venv/bin/activate
        pip install -q -r requirements.txt 2>/dev/null
        pip install -q pytest httpx 2>/dev/null
        python -m pytest tests/ -v
        exit $?
        ;;

    --dev)
        echo -e "${YELLOW}Starting in development mode...${NC}"
        echo -e "${YELLOW}Starting backend...${NC}"
        cd backend
        python3 -m venv .venv 2>/dev/null || true
        source .venv/bin/activate 2>/dev/null || . .venv/bin/activate
        pip install -q -r requirements.txt 2>/dev/null
        JWT_SECRET="$JWT_SECRET" python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
        BACKEND_PID=$!
        cd ../frontend
        echo -e "${YELLOW}Starting frontend...${NC}"
        npm install --silent 2>/dev/null
        npm run dev &
        FRONTEND_PID=$!
        echo ""
        echo -e "${GREEN}======================================${NC}"
        echo -e "${GREEN}  AAP Deployment Wizard (Dev Mode)${NC}"
        echo -e "${GREEN}  Frontend: http://localhost:5173${NC}"
        echo -e "${GREEN}  Backend:  http://localhost:8000${NC}"
        echo -e "${GREEN}======================================${NC}"
        echo ""
        echo "Press Ctrl+C to stop"
        trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
        wait
        exit 0
        ;;

    *)
        # Default: build and run with Docker
        ;;
esac

# Check that the AAP tarball exists
if [ ! -f ansible-automation-platform-containerized-setup-2.6-6.tar.gz ]; then
    echo -e "${RED}Error: AAP setup tarball not found!${NC}"
    echo ""
    echo "Download the AAP 2.6 containerized setup tarball from:"
    echo "  https://access.redhat.com/downloads/content/480"
    echo ""
    echo "Then place it in this directory as:"
    echo "  ansible-automation-platform-containerized-setup-2.6-6.tar.gz"
    exit 1
fi

# Stop any existing container
$RUNTIME stop $APP_NAME 2>/dev/null || true
$RUNTIME rm $APP_NAME 2>/dev/null || true

# Build
echo -e "${YELLOW}Building container image (this takes 2-3 minutes on first run)...${NC}"
$RUNTIME build -t $IMAGE_NAME .

# Run
echo -e "${YELLOW}Starting ${APP_NAME}...${NC}"
$RUNTIME run -d --name $APP_NAME \
    -p ${PORT}:443 \
    -e TLS_CN="$TLS_CN" \
    -e JWT_SECRET="$JWT_SECRET" \
    -e CORS_ORIGINS="$CORS_ORIGINS" \
    ${AZURE_OPENAI_ENDPOINT:+-e AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT"} \
    ${AZURE_OPENAI_KEY:+-e AZURE_OPENAI_KEY="$AZURE_OPENAI_KEY"} \
    ${AZURE_OPENAI_MODEL:+-e AZURE_OPENAI_MODEL="$AZURE_OPENAI_MODEL"} \
    $IMAGE_NAME

# Wait for startup
echo -e "${YELLOW}Waiting for startup...${NC}"
for i in $(seq 1 15); do
    if curl -sk https://localhost:${PORT}/api/health 2>/dev/null | grep -q '"ok"'; then
        break
    fi
    sleep 1
done

# Verify
if curl -sk https://localhost:${PORT}/api/health 2>/dev/null | grep -q '"ok"'; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  AAP Deployment Wizard is running!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "  URL:  ${GREEN}https://localhost${NC}"
    echo -e "  JWT:  ${YELLOW}${JWT_SECRET:0:12}...${NC}"
    echo ""
    echo "  Accept the self-signed certificate warning in your browser."
    echo ""
    echo "  To stop:  ./run.sh --stop"
    echo "  Logs:     $RUNTIME logs -f $APP_NAME"
    echo ""
else
    echo -e "${RED}Warning: Container started but health check failed.${NC}"
    echo "Check logs: $RUNTIME logs $APP_NAME"
fi
