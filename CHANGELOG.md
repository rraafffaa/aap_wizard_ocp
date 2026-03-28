# Changelog

All notable changes to the AAP Deployment Wizard are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-07

### Features

#### Wizard Flow
- 13-step guided deployment wizard for AAP 2.6 containerized installation
- Growth (all-in-one) and Enterprise (multi-node) topology support
- Step-by-step validation with real-time error feedback
- EULA acceptance step with full license text display
- Red Hat subscription manifest upload and validation
- Interactive host configuration with SSH connectivity testing
- Component selection and placement across inventory hosts
- Database configuration for both internal and external PostgreSQL
- Network settings for custom DNS, NTP, SSL/TLS, and proxy configuration
- Credential management for admin passwords, registry auth, and SSH keys
- Full deployment configuration review with diff comparison
- Preflight checks verifying host readiness before deployment
- Live deployment execution with streaming log output
- Post-deployment completion summary with access URLs

#### Topology & Visualization
- Interactive SVG topology diagram showing component placement across nodes
- Visual distinction between Growth (single-node) and Enterprise (multi-node) layouts
- Real-time topology updates as hosts and components are configured

#### Deployment Engine
- Ansible inventory generator producing valid containerized installer inventory files
- Preflight checker validating SSH connectivity, OS versions, disk space, and ports
- WebSocket-based live deployment log streaming with session management
- Deployment cancellation and session cleanup
- Support for the official `ansible-automation-platform-containerized-setup-2.6` installer bundle

#### Backend Services
- SSH connection manager with key-based and password authentication
- TLS certificate manager for generating self-signed certificates
- Health monitoring service for post-deployment component checks
- Audit trail service logging all wizard actions with timestamps
- Notification service for deployment status alerts
- Rollback manager for reverting failed deployments

#### UX & Accessibility
- PatternFly 6 design system for visual consistency with AAP UI
- Dark mode and light mode theme support with system preference detection
- Keyboard shortcuts and command palette (Ctrl/Cmd+K) for power users
- Contextual help panel with step-specific documentation
- Password strength indicator with real-time feedback
- Form-level and field-level validation with descriptive error messages
- Responsive layout for desktop and tablet viewports

#### Configuration Management
- Deployment profile presets for common configurations
- Configuration diff engine showing changes between steps
- Export and import of deployment configurations (JSON)
- Audit timeline showing the full history of configuration changes

#### Internationalization
- i18n framework with externalized string resources
- English (en) language pack included

### Architecture

- **Frontend:** React 18 + TypeScript with Vite 6 build tooling
- **UI Framework:** PatternFly 6 (Red Hat design system)
- **Backend:** FastAPI (Python 3.11+) with async request handling
- **Real-time:** WebSocket connections for deployment log streaming
- **Validation:** Pydantic v2 models for request/response schemas
- **SSH:** Paramiko-based SSH connectivity for host management
- **Crypto:** Python `cryptography` library for certificate generation
- **Bundled:** Single-container Docker image serving both frontend and API
- **Dev tooling:** Vite dev server with API proxy, hot module replacement

### Infrastructure

- Multi-stage Dockerfile (Node 20 + Python 3.12)
- Docker Compose for development and production
- GitHub Actions CI pipeline with lint, test, and build jobs
- Release workflow with GitHub Container Registry publishing
- Vitest test framework for frontend
- pytest + pytest-asyncio for backend testing
- Ruff linter and formatter for Python code
- Makefile with common development commands

### API Endpoints

| Method | Path                            | Description                     |
|--------|---------------------------------|---------------------------------|
| GET    | `/api/health`                   | Health check                    |
| POST   | `/api/preflight`                | Run preflight checks            |
| POST   | `/api/inventory/generate`       | Generate Ansible inventory      |
| POST   | `/api/inventory/validate`       | Validate inventory file         |
| POST   | `/api/deploy/start`             | Start deployment session        |
| POST   | `/api/deploy/{id}/cancel`       | Cancel running deployment       |
| GET    | `/api/deploy/{id}/status`       | Get deployment status           |
| WS     | `/ws/deploy/{id}`               | Live deployment log stream      |

[1.0.0]: https://github.com/redhat-ansible/aap-deployment-wizard/releases/tag/v1.0.0
