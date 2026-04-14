# Claude Code Guidance — AAP Deployment Wizard (OCP)

## What This Project Is

A native **Electron desktop app** (not a browser app) that guides users through deploying Red Hat Ansible Automation Platform 2.6 on **OpenShift Container Platform** or **RHEL 9 VMs** (containerized). Supports both deployment platforms with a shared wizard UI.

## Who This Is For

- **Primary users:** Red Hat customers and SAs deploying AAP on OpenShift or RHEL
- **Goal:** Eliminate the complexity of manually configuring AAP Operator CRs, subscriptions, namespace setup, or SSH-based inventory generation

## Architecture

```
Electron (main.cjs)
  ├── Auto-starts Python FastAPI backend on port 8000
  └── Loads React + PatternFly frontend (Vite dev server or built dist/)

Frontend (React 18 + PatternFly 6)
  └── Wizard step components in frontend/src/steps/

Backend (Python FastAPI)
  ├── app/main.py            — API routes (containerized + OCP)
  ├── app/models.py          — Pydantic models
  ├── app/deployer.py        — SSH-based deployment engine (containerized)
  ├── app/ocp_deployer.py    — OCP deployment engine (operator-based)
  ├── app/ocp_client.py      — OpenShift API client (httpx)
  ├── app/ocp_preflight.py   — OCP-specific pre-flight checks (10 checks)
  ├── app/cr_generator.py    — Custom Resource YAML generator
  ├── app/inventory.py       — INI inventory file generator
  ├── app/preflight.py       — Pre-flight system checks
  ├── app/auth.py            — JWT authentication
  ├── app/middleware.py      — Request middleware
  ├── app/cli.py             — CLI interface
  ├── app/onboarding.py      — Post-deploy onboarding
  ├── app/task_queue.py      — Background task queue
  ├── app/worker.py          — Task worker
  └── app/services/          — 22 service modules (see below)
```

### Service Modules (`backend/app/services/`)
SSH manager, AI debugger, AI service, audit, backup, certificate manager, config migrator, config store, config validator, DNS validator, health monitor, inventory templates, log analyzer, metrics collector, notification service, port scanner, profile service, report generator, rollback manager, RH download, scheduler, system info

### OCP-Specific Components
- **OCP wizard steps:** ClusterStep, NamespaceStep, OperatorStep, ReplicasStep
- **Containerized wizard steps:** SubscriptionStep, TopologyStep, TargetStep, HostsStep
- **Shared steps:** WelcomeStep, EulaStep, DatabaseStep, NetworkStep, CredentialsStep, AdvancedVariablesStep, PreflightStep, DeployStep, CompleteStep

## How to Run

```bash
# First-time setup + launch (installs everything)
./setup.sh

# Launch only (skip dependency install)
./setup.sh --launch

# Run all tests
./setup.sh --test
```

The app opens as a native desktop window (Electron). The Python backend starts automatically.

## Running Tests

### Backend tests
```bash
cd backend
source .venv/bin/activate
python -m pytest tests/ -v --tb=short
```

### Frontend tests
```bash
cd frontend
npm run test
```

### Both at once
```bash
./setup.sh --test
```

## Key Technical Details

### AAP Installer Tarball
- The tarball is **NOT bundled** in the repo — it is downloaded at deploy time
- Users provide a Red Hat offline token (from https://access.redhat.com/management/api)
- The token is exchanged for an access token via Red Hat SSO
- The tarball is downloaded from the RHSM API and cached in `~/.aap-wizard/cache/`
- Fallback: if no token is provided, the wizard uses `ansible-galaxy` for collection installation
- Download service: `backend/app/services/rh_download.py`

### Red Hat Tested Topologies
- The wizard features Red Hat-tested deployment profiles
- Profiles are served via `GET /api/profiles/tested` from `backend/app/services/profile_service.py`
- Custom topologies are supported but shown with a warning badge

### Deployment Flow — Containerized (deployer.py)
1. SSH into target VM with password auth (via `paramiko`)
2. Install prerequisites (podman, ansible-core, etc.)
3. Download or upload the AAP tarball (via RH offline token or local cache)
4. Generate INI inventory file from wizard config
5. Run `ansible-playbook -i inventory ansible.containerized_installer.install`
6. Post-install validation (container health, HTTP checks)

### Deployment Flow — OCP (ocp_deployer.py)
1. Connect to cluster (verify API + RBAC)
2. Create namespace
3. Check/install AAP Operator (Subscription + OperatorGroup)
4. Wait for operator CSV readiness (up to 10 min)
5. Create Secrets (admin password, optional Postgres)
6. Apply AnsibleAutomationPlatform CR
7. Wait for reconciliation (up to 30 min)
8. Retrieve routes and validate

### INI Inventory Quoting
Passwords with special characters (`#`, `=`, `;`, `'`, spaces) must be properly quoted. The `_quote_ini()` function in `inventory.py` handles this.

### Electron + Backend Integration
- `electron/main.cjs` spawns the Python backend as a child process
- Frontend detects `file://` protocol and routes API calls to `http://127.0.0.1:8000`
- Backend health check: `GET /api/health` must return 200 before the window loads

### Known Deployment Issues
- `/home` on target VMs is often small — the deployer auto-relocates podman storage to `/opt`
- EE images (`ee-minimal-rhel9`, `ee-supported-rhel9`) must be pre-pulled as BOTH user and root
- The installer timeout is set to 7200s (2 hours) for large deployments
- Hub image push may 502 for large images (non-critical)

## Security Rules

- **Never** hardcode credentials, IPs, tokens, or passwords in code, docs, or memory files
- All secrets via env vars (see `.env.example` for reference)
- Frontend auth uses sessionStorage for JWT tokens — never localStorage
- Passwords and RH offline tokens stripped from any client-side storage
- WebSocket connections require JWT auth

## Code Style & Conventions

- **Frontend**: TypeScript, React functional components, PatternFly 6 components
- **Backend**: Python 3.10+, FastAPI, async/await, type hints
- **Tests**: pytest (backend), vitest (frontend)
- **No auto-commit**: Always ask before committing
- **Passwords/secrets**: Never log or store in plaintext; use env vars or sessionStorage

## File Organization

| Path | Purpose |
|------|---------|
| `frontend/src/steps/` | Each wizard step is a separate component |
| `frontend/src/components/` | Shared UI components |
| `frontend/src/hooks/` | React hooks (store, validation, deploy) |
| `frontend/src/utils/` | Validators, formatters, crypto |
| `backend/app/` | All backend application code |
| `backend/tests/` | Backend test files |
| `frontend/src/__tests__/` | Frontend test files |

## Common Tasks

### Adding a new wizard step
1. Create component in `frontend/src/steps/`
2. Add to step arrays in `frontend/src/types.ts` (both CONTAINERIZED_STEPS/OPENSHIFT_STEPS and SECTIONS)
3. Add to `renderStep()` in `frontend/src/App.tsx`
4. Add validation logic in `frontend/src/hooks/useValidation.ts`

### Modifying deployment behavior
1. Edit `backend/app/deployer.py` for containerized deployment logic
2. Edit `backend/app/ocp_deployer.py` for OCP deployment logic
3. Edit `backend/app/inventory.py` for inventory generation
4. Update corresponding tests in `backend/tests/`

### Changing API endpoints
1. Backend routes in `backend/app/main.py`
2. Frontend API calls in `frontend/src/api.ts`

### FastAPI Route Ordering
Literal path routes (e.g., `/api/profiles/tested`) must be declared **before** parameterized routes (e.g., `/api/profiles/{profile_id}`), otherwise FastAPI will match the literal as a parameter value.
