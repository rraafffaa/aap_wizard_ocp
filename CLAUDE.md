# Claude Code Guidance — AAP Deployment Wizard (OCP)

## What This Project Is

A native **Electron desktop app** (not a browser app) that guides users through deploying Red Hat Ansible Automation Platform 2.6 on **OpenShift Container Platform**. Forked from the original containerized wizard (which targets RHEL 9 VMs), this variant deploys AAP via the AAP Operator and Custom Resources instead of SSH + ansible-playbook.

## Who This Is For

- **Primary users:** Red Hat customers and SAs deploying AAP on OpenShift
- **Goal:** Eliminate the complexity of manually configuring AAP Operator CRs, subscriptions, and namespace setup

## Architecture

```
Electron (main.cjs)
  ├── Auto-starts Python FastAPI backend on port 8000
  └── Loads React + PatternFly frontend (Vite dev server or built dist/)

Frontend (React 18 + PatternFly 6)
  └── 21 wizard steps in frontend/src/steps/

Backend (Python FastAPI)
  ├── app/main.py            — API routes
  ├── app/deployer.py        — SSH-based deployment engine (from original wizard)
  ├── app/ocp_deployer.py    — OCP deployment engine (operator-based)
  ├── app/ocp_client.py      — OpenShift API client
  ├── app/ocp_preflight.py   — OCP-specific pre-flight checks
  ├── app/cr_generator.py    — Custom Resource YAML generator
  ├── app/inventory.py       — INI inventory file generator
  ├── app/preflight.py       — Pre-flight system checks
  ├── app/auth.py            — JWT authentication
  └── app/services/          — SSH, AI debugger, audit, backup, health, certs, etc.
```

### OCP-Specific Components
- **OCP wizard steps:** ClusterStep, NamespaceStep, OperatorStep, SubscriptionStep, ReplicasStep, TopologyStep, OnboardingStep
- **Shared with original wizard:** Auth, Electron shell, many UI components, AI debugger, audit service
- **Original wizard:** Containerized RHEL 9 deployment target

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
- The file `ansible-automation-platform-containerized-setup-2.6-6.tar.gz` is bundled in the repo
- It contains the `ansible.containerized_installer` collection — this is NOT available on public Ansible Galaxy
- The tarball is uploaded to the target VM and extracted during deployment

### Deployment Flow (deployer.py)
1. SSH into target VM with password auth (via `paramiko`)
2. Install prerequisites (podman, ansible-core, etc.)
3. Upload and extract the AAP tarball
4. Generate INI inventory file from wizard config
5. Run `ansible-playbook -i inventory ansible.containerized_installer.install`
6. Post-install validation (container health, HTTP checks)

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
- Passwords stripped from any client-side storage
- WebSocket connections require JWT auth

## Code Style & Conventions

- **Frontend**: TypeScript, React functional components, PatternFly 6 components
- **Backend**: Python 3.10+, FastAPI, async/await, type hints
- **Tests**: pytest (backend), vitest (frontend)
- **No auto-commit**: Always ask before committing
- **Passwords/secrets**: Never log or store in plaintext; use env vars or sessionStorage
- **Spec-kit**: Use spec-driven development workflow for new features (skills in `.claude/skills/`)

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
2. Add to step array in the main wizard component
3. Add validation logic in the appropriate hook

### Modifying deployment behavior
1. Edit `backend/app/deployer.py` for deployment logic
2. Edit `backend/app/inventory.py` for inventory generation
3. Update corresponding tests in `backend/tests/`

### Changing API endpoints
1. Backend routes in `backend/app/main.py`
2. Frontend API calls in `frontend/src/api.ts`
