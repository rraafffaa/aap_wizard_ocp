# AAP Deployment Wizard — Complete Guide

A guided, web-based deployment wizard for **Red Hat Ansible Automation Platform 2.6** containerized installations. This document covers every feature, component, setup requirement, and deployment option.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup & Installation](#setup--installation)
  - [Local Development](#local-development)
  - [Docker Compose (Full Stack)](#docker-compose-full-stack)
  - [Single Container (Monolith)](#single-container-monolith)
  - [OpenShift Deployment](#openshift-deployment)
- [Using the Wizard](#using-the-wizard)
  - [Step 1 — Welcome](#step-1--welcome)
  - [Step 2 — License Agreement (EULA)](#step-2--license-agreement-eula)
  - [Step 3 — Installation Type](#step-3--installation-type)
  - [Step 4 — Topology](#step-4--topology)
  - [Step 5 — SSH Target](#step-5--ssh-target)
  - [Step 6 — Hosts](#step-6--hosts)
  - [Step 7 — Components](#step-7--components)
  - [Step 8 — Database](#step-8--database)
  - [Step 9 — Network & TLS](#step-9--network--tls)
  - [Step 10 — Credentials](#step-10--credentials)
  - [Step 11 — Pre-flight Checks](#step-11--pre-flight-checks)
  - [Step 12 — Review](#step-12--review)
  - [Step 13 — Deploy](#step-13--deploy)
  - [Step 14 — Complete](#step-14--complete)
- [Frontend Components](#frontend-components)
  - [Shared UI Components](#shared-ui-components)
  - [Custom Hooks](#custom-hooks)
  - [Utility Modules](#utility-modules)
  - [Internationalization (i18n)](#internationalization-i18n)
  - [Design System & Theming](#design-system--theming)
- [Backend API Reference](#backend-api-reference)
  - [Health](#health)
  - [SSH](#ssh)
  - [Preflight & Preparation](#preflight--preparation)
  - [Inventory](#inventory)
  - [Deployment](#deployment)
  - [Profiles](#profiles)
  - [Audit](#audit)
  - [Backups](#backups)
  - [Certificates](#certificates)
  - [Rollback](#rollback)
  - [Notifications](#notifications)
  - [Reports](#reports)
  - [Config Validation](#config-validation)
  - [WebSocket](#websocket)
- [Backend Services](#backend-services)
- [Deployment Options](#deployment-options)
  - [Docker Images](#docker-images)
  - [OpenShift Manifests](#openshift-manifests)
  - [CI/CD Pipelines](#cicd-pipelines)
  - [Scripts](#scripts)
- [Configuration Import/Export](#configuration-importexport)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Technology Stack](#technology-stack)

---

## Overview

The AAP Deployment Wizard replaces manual Ansible inventory file editing with a 14-step guided UI. It handles:

- **Topology selection** — Growth (all-in-one) or Enterprise (multi-node)
- **Real-time pre-flight checks** — OS, RAM, CPU, disk, Podman, ansible-core
- **Automatic inventory generation** — No manual INI editing
- **Live deployment progress** — WebSocket-powered streaming logs
- **Post-install validation** — Verifies platform accessibility

| Manual Process | Wizard |
|----------------|--------|
| Edit INI inventory files by hand | Visual form with validation |
| Memorize 50+ variable names | Guided fields with descriptions |
| No pre-validation | Automatic pre-flight checks |
| No progress visibility | Real-time phase tracking |
| Read documentation for every option | Contextual help inline |
| Error-prone copy-paste | Type-safe config generation |
| No topology visualization | Visual topology comparison |

---

## Architecture

```
┌────────────────────────────────┐
│  React + PatternFly Frontend   │  Port 3000 (dev) / 8080 (prod)
│  (Vite + TypeScript)           │
└──────────┬─────────────────────┘
           │ HTTP / WebSocket
┌──────────▼─────────────────────┐
│  Python FastAPI Backend        │  Port 8000
│  • SSH verification            │
│  • Preflight checks            │
│  • Inventory generation        │
│  • Deployment orchestration    │
│  • WebSocket log streaming     │
│  • Profiles, Audit, Backups    │
│  • Certificate management      │
│  • Notifications, Reports      │
└──────────┬─────────────────────┘
           │
┌──────────▼─────────────────────┐
│  PostgreSQL 16 + Redis 7       │
│  (State, task queue, sessions) │
└──────────┬─────────────────────┘
           │
┌──────────▼─────────────────────┐
│  AAP Containerized Installer   │
│  (ansible-playbook + Podman)   │
└────────────────────────────────┘
```

---

## Prerequisites

### For Running the Wizard

| Requirement | Version |
|-------------|---------|
| Node.js | 18+ |
| npm | 8+ |
| Python | 3.10+ |
| Docker / Podman | 24+ (for containerized deployment) |

### For AAP Target Hosts (What You're Deploying To)

| Requirement | Details |
|-------------|---------|
| OS | Red Hat Enterprise Linux 9.4+ or 10+ |
| RAM | Minimum 16 GB |
| CPUs | Minimum 4 |
| Disk | Minimum 60 GB |
| Subscription | Valid AAP subscription |
| Registry | Red Hat registry credentials (online install) |
| User | Dedicated non-root user with sudo privileges |
| Hostname | FQDN-resolvable hostname(s) |
| Podman | Installed on target |
| ansible-core | Installed on target |

---

## Setup & Installation

### Local Development

**Frontend only (demo mode):**

```bash
cd frontend
npm install
npm run dev
```

Opens at http://localhost:3000. API-dependent features (preflight, deploy) require the backend.

**Full stack (frontend + backend):**

```bash
# Terminal 1 — Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Or use the Makefile shortcut:

```bash
make dev
```

This starts both the backend on `:8000` and frontend on `:3000` concurrently.

### Docker Compose (Full Stack)

The 5-service production stack:

```bash
make stack
# Or directly:
docker compose up --build -d
```

| Service | Port | Image |
|---------|------|-------|
| Frontend (Nginx) | 8080 | `docker/frontend.Dockerfile` |
| Backend (FastAPI) | 8000 | `docker/backend.Dockerfile` |
| Worker | — | `docker/worker.Dockerfile` |
| PostgreSQL 16 | 5432 | `postgres:16-alpine` |
| Redis 7 | 6379 | `redis:7-alpine` |

**Development profile** (with hot-reload):

```bash
docker compose --profile dev up --build
```

This mounts source code as volumes for live reload. Frontend at `:3000`, backend at `:8001`.

### Single Container (Monolith)

```bash
docker build -t aap-deployment-wizard .
docker run --rm -p 8000:8000 aap-deployment-wizard
```

Multi-stage build: Node 20 builds the frontend, Python 3.12 serves both backend + static files on port 8000.

### OpenShift Deployment

**1. Login to your cluster:**

```bash
oc login --token=<token> --server=https://<cluster-api>
```

**2. Build & push images:**

```bash
make oc-build    # Builds frontend, backend, worker images
make oc-push     # Pushes to your container registry
```

**3. Set up secrets:**

```bash
make oc-setup    # Creates project, pull secrets
```

**4. Deploy:**

```bash
make oc-deploy   # Applies all manifests in order
```

**5. Check status:**

```bash
make oc-status   # Shows pods, services, routes, HPA
```

Images are pushed to `quay.io/<your-username>/aap-wizard-{frontend,backend,worker}:latest` by default. Override with:

```bash
REGISTRY=myregistry.io IMG_NS=myorg TAG=v1.0.0 make oc-build oc-push
```

---

## Using the Wizard

### Step 1 — Welcome

The landing page introduces the wizard with:

- Red Hat + Ansible branding
- Three feature cards (Guided Setup, Pre-flight Checks, Live Progress)
- System requirements checklist
- **Get Started** button to begin

No configuration happens here — this is informational.

### Step 2 — License Agreement (EULA)

- Displays the full Red Hat Ansible Automation Platform EULA in a scrollable panel
- **Checkbox** to accept the agreement
- A warning appears if you proceed without accepting
- Config field: `eula_accepted` (boolean)

### Step 3 — Installation Type

Choose how AAP will be installed:

| Option | Description |
|--------|-------------|
| **Online** | Pull container images from `registry.redhat.io` at install time |
| **Disconnected (Bundled)** | Use a pre-downloaded bundle for air-gapped environments |

**Online fields:**
- Registry Username (required)
- Registry Password (required)

**Disconnected fields:**
- Bundle Directory Path

**Both:**
- Install Directory (default: `/opt/aap`)

### Step 4 — Topology

Select the deployment topology:

| Topology | Description |
|----------|-------------|
| **Growth (All-in-One)** | All components on a single host. Best for evaluation, small teams (<100 hosts). Redis set to standalone. |
| **Enterprise (Multi-Node)** | Components across multiple hosts. Production-grade, HA-capable. Recommended for 100+ hosts. |

Features:
- **Sizing Calculator** — Expandable table mapping team size/job count to hardware recommendations
- **Topology comparison table** — Side-by-side feature comparison
- Visual topology selection cards with feature lists

### Step 5 — SSH Target

Configure connectivity to the target deployment host:

| Field | Description |
|-------|-------------|
| Target Host | IP address or hostname |
| SSH Port | Default 22 (1–65535) |
| SSH Username | Required |
| SSH Password | Required |

- **Verify Connection** button calls `POST /api/ssh/verify`
- Shows success (hostname, OS, latency) or failure details
- Button disabled until host, user, and password are filled

### Step 6 — Hosts

Define FQDNs for each AAP component:

**Growth topology:** Single hostname applied to all components (Gateway, Controller, Hub, EDA).

**Enterprise topology:** Separate host lists for each component:

| Component | Field |
|-----------|-------|
| Gateway | One or more FQDNs |
| Controller | One or more FQDNs |
| Automation Hub | One or more FQDNs |
| Event-Driven Ansible | One or more FQDNs |
| Execution Nodes | Host + receptor type (execution or hop) |

For remote hosts, configure SSH settings per host (hostname, SSH user, key path, port).

### Step 7 — Components

Configure platform component options:

| Component | Options |
|-----------|---------|
| **Gateway** | Always enabled (required entry point) |
| **Automation Controller** | Memory capacity slider (10–100%, default 50%) |
| **Automation Hub** | Toggle "Seed certified collections after installation" |
| **Event-Driven Ansible** | Select safe event source plugins (webhook, alertmanager, url_check, range, file_watch, journald) |
| **Redis** | Standalone or Cluster mode (Enterprise only) |

### Step 8 — Database

Configure PostgreSQL for all AAP components:

| Option | Description |
|--------|-------------|
| **Managed** | Wizard installs and manages PostgreSQL on the target (Growth only) |
| **External** | Connect to an existing PostgreSQL instance (required for Enterprise) |

**External database fields:**
- Database Host, Port (default 5432)
- Admin Username, Admin Password

**Per-component database credentials:**
- Gateway: database name, password
- Controller: database name, password
- Hub: database name, password
- EDA: database name, password

### Step 9 — Network & TLS

Configure network ports and TLS certificates:

**Ports:**

| Port | Default | Description |
|------|---------|-------------|
| HTTPS | 443 | Platform HTTPS access |
| HTTP | 80 | Redirected to HTTPS |
| Receptor | 27199 | Mesh communication |

**TLS options:**
- Enable/Disable HTTPS switch
- Custom CA Certificate path
- Server Certificate path
- Server Private Key path

**Reference table:** Lists all firewall ports to open (HTTPS, HTTP, Receptor, PostgreSQL 5432, Redis 6379, SSH 22).

### Step 10 — Credentials

Set admin passwords for each component:

- **Generate All** — Creates unique 24-character passwords for every component
- **Shared Password** — Enter once and apply to all components
- **Per-component** — Individual password fields for Gateway, Controller, Hub, and EDA
- **Per-component Generate** — Random password button next to each field

Passwords are generated using `crypto.getRandomValues()` (cryptographically secure).

### Step 11 — Pre-flight Checks

Validates the target host before deployment:

| Check | What It Verifies |
|-------|------------------|
| Operating System | RHEL 9.4+ or 10+ |
| RAM | Minimum 16 GB |
| CPU | Minimum 4 cores |
| Disk Space | Minimum 60 GB free |
| Podman | Installed and functional |
| ansible-core | Installed and version-compatible |
| DNS Resolution | Hostnames resolve correctly |
| Port Availability | Required ports are not in use |

- **Run Pre-flight Checks** — Calls `POST /api/preflight`
- **Prepare Host (Auto-fix)** — Installs missing dependencies and re-runs checks via `POST /api/prepare`
- Shows pass/fail/warning per check with messages
- Summary counts: passed, warnings, failed

### Step 12 — Review

Full configuration review before deployment:

- **Deployment overview** — Topology, installation type, install directory, Redis mode, EULA status
- **Hosts summary** — All configured hosts by component
- **Network & security** — Ports, TLS settings
- **Database summary** — Type, host, credentials per component
- **Admin credentials** — Masked passwords per component
- **Editable SSH target** — Last chance to change host, user, password
- **Dry Run toggle** — Switch between dry run (validate only) and full install
- **Generated inventory** — Show/hide the Ansible inventory file, copy to clipboard, download as file
- **Backend validation** — Calls `/api/inventory/validate` and shows any errors

### Step 13 — Deploy

Live deployment with real-time progress:

**Phases:**

| Phase | Description |
|-------|-------------|
| Validate | Configuration validation |
| Inventory | Generate Ansible inventory |
| Upload | Transfer files to target |
| Preflight | Final host verification |
| Install | Run ansible-playbook |
| Post-install | Verify platform health |
| Complete | Finalize deployment |

**Features:**
- **Progress bar** with percentage
- **Phase tracker** — Visual status per phase (pending, running, complete, error)
- **Live log console** — Color-coded Ansible output (ok=green, changed=yellow, error=red)
- **WebSocket connection** — Real-time log streaming with polling fallback
- **Connection badge** — Shows "Live" (WebSocket) or "Polling" mode
- **Cancel** — Stop a running deployment
- **Retry** — Restart after failure
- **Export Logs** — Download deployment logs

### Step 14 — Complete

Post-deployment success screen:

- Success icon and confirmation message
- **Open AAP Platform** button (links to gateway URL on configured HTTPS port)
- **Access details** — Platform URL, topology, component list
- **Next steps checklist:**
  1. Review the deployment manifest
  2. Create your first project
  3. Add managed hosts
  4. Create and run a job template
  5. Configure Event-Driven Ansible rules
- **Resource links** — AAP Documentation, Getting Started Guide, Customer Portal, Ansible Galaxy, Red Hat Learning, Community Support

---

## Frontend Components

### Shared UI Components

| Component | Purpose |
|-----------|---------|
| **AnsibleLogo** | SVG Ansible logo (red circle, white "A") |
| **RedHatLogo** | SVG Red Hat logo |
| **TopologyDiagram** | Interactive SVG topology visualization for Growth/Enterprise |
| **ErrorBoundary** | React error boundary with stack trace display and recovery buttons |
| **FormField** | Form wrapper with label, error, helper text; includes TextInput, NumberInput, SwitchInput |
| **PasswordStrength** | 5-segment password strength indicator with entropy calculation |
| **CopyButton** | Copy-to-clipboard with "Copied!" feedback |
| **StatusIndicator** | Status dots and badges (healthy, degraded, down, warning, etc.) |
| **TimeAgo** | Relative timestamps with auto-update |
| **LoadingState** | Skeleton loaders, spinners, empty states, error states, connection status |
| **ConfirmDialog** | Modal confirmation dialog with focus trap and Escape-to-close |
| **Breadcrumbs** | Step breadcrumb navigation (Section > Step) |
| **HelpPanel** | Contextual help sidebar with step-specific content, FAQ, best practices, and links |
| **CommandPalette** | `Ctrl+K` command palette for navigation and actions with fuzzy search |
| **ConfigDiff** | Visual diff viewer for configuration changes (grouped by category) |
| **AuditTimeline** | Audit log timeline with search, category filters, and diff preview |
| **BackupManager** | Create, restore, import/export configuration backups |
| **ProfileManager** | Manage preset and custom configuration profiles with diff preview |
| **CertificateViewer** | View, validate, and generate TLS certificates |
| **HealthDashboard** | Platform health overview (component status, DB, resources, events) |
| **DeploymentHistory** | Past deployment records with search, filter, and re-deploy |
| **NotificationCenter** | Notification dropdown with categories, mark-read, and test notification |
| **SettingsPanel** | Wizard settings (theme, font, compact mode, notifications, shortcuts, backup, debug) |

### Custom Hooks

| Hook | Purpose |
|------|---------|
| **useWizardStore** | Central wizard state via React Context + useReducer. Holds config, current step, completed steps, UI toggles. Auto-saves to localStorage. |
| **useStepMachine** | Step navigation with validation guards, transition history, and hash sync |
| **useValidation** | Per-step validation rules (EULA, subscription, target, hosts, credentials, etc.) |
| **useDeployment** | Deployment lifecycle (start, cancel, retry, phase tracking, log collection) |
| **useWebSocket** | WebSocket connection with automatic reconnect and exponential backoff |
| **useHealthCheck** | Platform health polling with auto-refresh |
| **useAuditLog** | Audit log state with config change tracking via diff engine |
| **useNotifications** | In-memory notification state with localStorage persistence |
| **useKeyboardShortcuts** | Global keyboard shortcuts (skips when input is focused) |
| **useTheme** | Theme state (light, dark, high-contrast, system) with localStorage persistence |

### Utility Modules

| Module | Purpose |
|--------|---------|
| **validators.ts** | Input validation — FQDN, IP, hostname, port range, password strength, Unix path, PEM, SSH key, CIDR, unique hosts, and composable validators |
| **crypto.ts** | `generatePassword` (24-char, crypto-secure), `hashString`, `generateUUID`, `generateSessionToken`, `maskSensitive`, `sanitizeInput`, `validateHostname` |
| **ansible.ts** | Ansible output parsing — line type detection, host/task extraction, RECAP parsing, colorization, playbook stats, error pattern matching |
| **diffEngine.ts** | Config diff computation — `computeDiff`, `flattenDiff`, `filterDiff`, `diffToText`, `diffToHTML`, change counting |
| **formatters.ts** | Formatting — bytes, duration, timestamps, relative time, password masking, truncation, slugification, topology/install-type labels, `debounce`, `throttle` |
| **network.ts** | API helpers — `isApiReachable`, `fetchWithRetry`, `createTimeoutController`, `buildWsUrl`, `connectSSE` |
| **profiles.ts** | Configuration profiles — preset profiles, custom CRUD, YAML import/export, diff preview, profile application |
| **storage.ts** | Typed localStorage wrapper with versioning, TTL, quota handling, and migration |
| **accessibility.ts** | A11y helpers — focus trapping, ARIA live regions, screen reader announcements, keyboard navigation, WCAG contrast checking, skip links |

### Internationalization (i18n)

- English locale in `src/i18n/en.ts` covering all steps, common labels, EULA text, topology descriptions, database labels, validation messages, and deployment phases
- Runtime in `src/i18n/index.ts` with `t('dot.notation.key')` lookup and `{param}` substitution
- Extensible to additional locales

### Design System & Theming

Built on PatternFly 6 with Red Hat brand guidelines:

**CSS Architecture:**
- `app.css` — Full design system (2000+ lines): tokens, layout, buttons, cards, forms, selection cards, status indicators, alerts, tables, progress, console, modals, toasts, code blocks, breadcrumbs
- `themes.css` — Light theme (default) and high-contrast theme overrides
- `animations.css` — Step transitions (slide, fade, scale), skeleton loaders, pulse/glow, stagger, collapse, tooltip, shake, typewriter, FAB, card hover; respects `prefers-reduced-motion`
- `responsive.css` — Breakpoints at 576/768/992/1200/1400px; sidebar collapse, stacked forms, mobile footer/header; print styles

**Theme support:**
- Light (default)
- High contrast
- System preference detection
- Theme toggle via settings panel or `useTheme` hook

**Typography:** Red Hat Display (headings), Red Hat Text (body), Red Hat Mono (code)

---

## Backend API Reference

Base URL: `http://localhost:8000`

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Backend health check |
| GET | `/api/health/platform` | Platform health (optional `?gateway_url=`) |

### SSH

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ssh/verify` | Verify SSH connectivity to target host |

**Body:** `{ target_host, target_user, target_password, target_ssh_port }`
**Response:** `{ connected, hostname, os, error, latency_ms }`

### Preflight & Preparation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/preflight` | Run pre-flight checks (120s timeout) |
| POST | `/api/prepare` | Install dependencies and re-run checks (300s timeout) |

### Inventory

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/inventory/generate` | Generate Ansible inventory from config |
| POST | `/api/inventory/validate` | Validate config and return errors |

### Deployment

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/deploy/start` | Start deployment |
| GET | `/api/deploy/{id}/status` | Get deployment status |
| POST | `/api/deploy/{id}/cancel` | Cancel running deployment |

### Profiles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profiles` | List profiles (`?category=preset|custom`) |
| GET | `/api/profiles/{id}` | Get profile |
| POST | `/api/profiles` | Create profile |
| PUT | `/api/profiles/{id}` | Update profile |
| DELETE | `/api/profiles/{id}` | Delete profile |
| GET | `/api/profiles/{id}/yaml` | Export profile as YAML |
| POST | `/api/profiles/import` | Import profile from YAML |

### Audit

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit` | List entries (`?category=&limit=&offset=&since=`) |
| GET | `/api/audit/stats` | Audit statistics |
| GET | `/api/audit/export` | Export log (`?format=json|csv|text`) |

### Backups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/backups` | List backups |
| POST | `/api/backups` | Create backup |
| GET | `/api/backups/{id}` | Get backup |
| DELETE | `/api/backups/{id}` | Delete backup |
| POST | `/api/backups/{id}/restore` | Restore backup |

### Certificates

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/certificates/generate` | Generate self-signed certs for hostnames |
| POST | `/api/certificates/validate` | Validate certificate chain |
| POST | `/api/certificates/info` | Parse certificate details |

### Rollback

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/deploy/{id}/snapshots` | List deployment snapshots |
| POST | `/api/deploy/{id}/rollback` | Rollback deployment |
| POST | `/api/deploy/{id}/retry/{phase}` | Retry from specific phase |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications/config` | Get notification config |
| POST | `/api/notifications/config` | Update notification config |
| POST | `/api/notifications/test` | Send test notification |
| GET | `/api/notifications/history` | Notification history |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/reports/generate` | Generate report (`type`: pre-deploy, post-deploy, config, health) |

### Config Validation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/config/validate` | Validate deployment config (score, errors, warnings) |

### WebSocket

| Protocol | Path | Description |
|----------|------|-------------|
| WS | `/ws/deploy/{session_id}` | Live deployment log stream |

---

## Backend Services

The backend includes 18+ service modules:

| Service | Purpose |
|---------|---------|
| `audit_service` | JSONL audit log with search, stats, export |
| `profile_service` | Preset/custom profiles, YAML import/export |
| `backup_service` | Config + inventory + audit backups |
| `rollback_manager` | Deployment snapshots and rollback |
| `notification_service` | Webhook notifications for deployment events |
| `certificate_manager` | TLS cert generation, validation, parsing |
| `report_generator` | Pre/post-deploy, config, health reports |
| `config_validator` | Full config validation with scoring |
| `health_monitor` | Platform health checks |
| `ssh_manager` | SSH connection management |
| `dns_validator` | DNS resolution verification |
| `port_scanner` | Port availability checks |
| `log_analyzer` | Deployment log analysis |
| `metrics_collector` | Performance metrics |
| `scheduler_service` | Background task scheduling |
| `system_info` | System information gathering |
| `config_migrator` | Config version migration |
| `inventory_templates` | Ansible inventory templates |

---

## Deployment Options

### Docker Images

| Image | Dockerfile | Port | Description |
|-------|-----------|------|-------------|
| Monolith | `Dockerfile` | 8000 | Backend + frontend in one container |
| Frontend | `docker/frontend.Dockerfile` | 8080 | Nginx serving React build + reverse proxy |
| Backend | `docker/backend.Dockerfile` | 8000 | FastAPI with uvicorn |
| Worker | `docker/worker.Dockerfile` | — | Redis task consumer |

All images use non-root users for security.

### OpenShift Manifests

Located in `openshift/`:

| File | Resource | Details |
|------|----------|---------|
| `00-namespace.yaml` | Namespace | `aap-wizard` project |
| `01-secrets.yaml` | Secrets | DB password, Redis password, registry pull secret |
| `02-configmap.yaml` | ConfigMap | APP_ENV, REDIS_URL, DATABASE_URL, worker settings |
| `03-postgres-pvc.yaml` | PVC | 5 Gi persistent volume for PostgreSQL |
| `04-postgres-deployment.yaml` | Deployment | PostgreSQL 16, Recreate strategy |
| `05-postgres-service.yaml` | Service | `wizard-postgres:5432` |
| `06-redis-deployment.yaml` | Deployment | Redis 7 Alpine |
| `07-redis-service.yaml` | Service | `wizard-redis:6379` |
| `08-backend-deployment.yaml` | Deployment | 2 replicas, rolling update |
| `09-backend-service.yaml` | Service | `wizard-backend:8000` |
| `10-worker-deployment.yaml` | Deployment | 1 replica |
| `11-frontend-deployment.yaml` | Deployment | 2 replicas |
| `12-frontend-service.yaml` | Service | `wizard-frontend:8080` |
| `13-frontend-route.yaml` | Route | Frontend with edge TLS |
| `14-backend-route.yaml` | Route | Backend API with WebSocket support, 300s timeout |
| `15-hpa.yaml` | HPA | Backend: 2–5 pods (CPU 70%, memory 80%); Frontend: 2–5 pods (CPU 70%) |

**AAP Operator manifests** (`openshift/aap-operator/`):

| File | Resource |
|------|----------|
| `01-operatorgroup.yaml` | OperatorGroup for AAP namespace |
| `02-subscription.yaml` | AAP Operator subscription (stable-2.5, manual approval) |
| `03-aap-instance.yaml` | AnsibleAutomationPlatform CR (Gateway, Controller, Hub, EDA, DB) |

### CI/CD Pipelines

**GitHub Actions** (`.github/workflows/`):

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | Push/PR to main | Lint frontend (tsc), test frontend (Vitest), lint backend (Ruff), test backend (pytest), build Docker (main only) |
| `release.yml` | Git tag `v*` | Build & push to ghcr.io, create GitHub release with changelog |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/build-images.sh` | Build frontend, backend, worker container images |
| `scripts/push-images.sh` | Push images to registry (set `REGISTRY` env var) |
| `scripts/deploy.sh` | Apply all OpenShift manifests in dependency order |
| `scripts/setup-openshift.sh` | Create project, configure pull secrets |
| `scripts/scale-demo.sh` | Demo: scale backend 5 → 2 replicas |
| `scripts/provision-vm.sh` | Provision Azure RHEL 9 VM (Standard_D4s_v3, 200 GB, opens ports 80/443/27199) |

---

## Configuration Import/Export

The wizard supports saving and loading configurations:

- **Export** — Downloads `aap-wizard-config.json` with the full `DeploymentConfig` object
- **Import** — Upload a JSON file to populate all wizard fields
- **Session persistence** — Config and current step auto-save to `localStorage`
- **Resume prompt** — On reload, offers to resume the previous session or start fresh
- **Profiles** — Save/load named configuration profiles (preset and custom)
- **Backups** — Create timestamped backups with restore capability

Header buttons for Import/Export are always visible. The `Downloads/aap-wizard-config.json` file in the repo is a sample configuration.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `?` | Open help panel |
| Arrow keys | Navigate within menus |
| `Escape` | Close modals, command palette, help panel |

Additional shortcuts are configurable in the Settings panel.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, PatternFly 6, Vite 6 |
| **Backend** | Python 3.12, FastAPI, WebSockets, Pydantic |
| **Database** | PostgreSQL 16 |
| **Cache/Queue** | Redis 7 |
| **SSH** | Paramiko |
| **TLS** | cryptography (Python) |
| **Templates** | Jinja2 (inventory generation) |
| **HTTP Client** | httpx |
| **Testing** | Vitest + Testing Library (frontend), pytest (backend) |
| **Linting** | TypeScript strict mode (frontend), Ruff (backend) |
| **Containers** | Docker / Podman, Nginx 1.27 |
| **Orchestration** | OpenShift / Kubernetes, HPA |
| **CI/CD** | GitHub Actions |
| **Registry** | quay.io, ghcr.io |
