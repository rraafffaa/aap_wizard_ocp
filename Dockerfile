# AAP Deployment Wizard — Self-Contained Container Build
#
# Builds both frontend and backend into a single container with:
#   - React UI (PatternFly 6)
#   - Python FastAPI backend
#   - AAP 2.6 containerized installer tarball (bundled)
#   - Self-signed TLS cert (generated at runtime)
#
# Usage:
#   docker build -t aap-wizard .
#   docker run -d -p 443:443 --name aap-wizard aap-wizard

# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend with SSL + built frontend
FROM python:3.12-slim
WORKDIR /app

# Install sshpass (for password-based SSH), ssh client, and openssl
RUN apt-get update && \
    apt-get install -y --no-install-recommends sshpass openssh-client openssl && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend into backend's expected location
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Include AAP containerized installer setup tarball
COPY ansible-automation-platform-containerized-setup-2.6-6.tar.gz /app/aap-setup.tar.gz

# Create entrypoint script that generates TLS cert at runtime
RUN printf '#!/bin/sh\nset -e\nif [ ! -f /app/key.pem ]; then\n  CN="${TLS_CN:-localhost}"\n  openssl req -x509 -newkey rsa:2048 -nodes \\\n    -keyout /app/key.pem -out /app/cert.pem -days 365 \\\n    -subj "/CN=$CN" 2>/dev/null\n  echo "Generated self-signed TLS cert for CN=$CN"\nfi\nexec uvicorn app.main:app --host 0.0.0.0 --port 443 \\\n  --ssl-keyfile /app/key.pem --ssl-certfile /app/cert.pem\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 443

ENTRYPOINT ["/app/entrypoint.sh"]
