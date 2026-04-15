# AAP Deployment Wizard (OCP) & Containerized

A native desktop application for deploying **Red Hat Ansible Automation Platform 2.6** on **OpenShift Container Platform** or **RHEL 9 VMs**. Replaces manual CR editing, operator configuration, and inventory management with a guided PatternFly wizard UI.

![Electron](https://img.shields.io/badge/Electron-35-blue) ![React](https://img.shields.io/badge/React-18-blue) ![Python](https://img.shields.io/badge/Python-3.12-green) ![PatternFly](https://img.shields.io/badge/PatternFly-6-red) ![License](https://img.shields.io/badge/License-MIT-green)

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/rraafffaa/aap_wizard_ocp.git
cd aap_wizard_ocp

# 2. Run setup (installs everything + launches the app)
./setup.sh
```

That's it. The desktop app opens automatically.

## What You Need

### For OpenShift Deployments

| Requirement | How to Get It |
|-------------|---------------|
| **Python 3.10+** | `brew install python3` or [python.org](https://www.python.org/downloads/) |
| **Node.js 18+** | `brew install node` or [nodejs.org](https://nodejs.org/) |
| **OpenShift cluster** | API URL + bearer token with cluster-admin privileges |

### For Containerized Deployments (RHEL 9)

| Requirement | How to Get It |
|-------------|---------------|
| **Python 3.10+** | `brew install python3` or [python.org](https://www.python.org/downloads/) |
| **Node.js 18+** | `brew install node` or [nodejs.org](https://nodejs.org/) |
| **Red Hat Registry credentials** | Your `rh-ee-*` username + password from [access.redhat.com](https://access.redhat.com) |
| **Red Hat offline token** (optional) | From [access.redhat.com/management/api](https://access.redhat.com/management/api) — used to download the AAP installer tarball |
| **A RHEL 9 target VM** | SSH access with sudo privileges |

The AAP installer tarball is **downloaded at deploy time** using your Red Hat offline token. If no token is provided, the wizard falls back to `ansible-galaxy` for collection installation.

## How It Works

The wizard supports two deployment platforms:

### OpenShift (Operator-based)

```
┌────────────────────────────────┐
│  AAP Deployment Wizard (App)   │
│  ┌──────────────────────────┐  │
│  │ React + PatternFly 6     │  │    K8s API
│  │ 13-step guided wizard    │  │ ──────────────▶  OpenShift Cluster
│  └────────┬─────────────────┘  │                   ┌──────────────┐
│           │                    │                   │ AAP Operator  │
│  ┌────────▼─────────────────┐  │                   │ • Gateway    │
│  │ Python FastAPI Backend   │  │                   │ • Controller │
│  │ (auto-started by app)    │  │                   │ • Hub        │
│  └──────────────────────────┘  │                   │ • EDA        │
└────────────────────────────────┘                   └──────────────┘
```

1. **Open the app** — Backend starts automatically
2. **Connect to your cluster** — OpenShift API URL + bearer token
3. **Follow the wizard** — Namespace, operator, replicas, database, etc.
4. **Click Deploy** — The app installs the AAP Operator, creates Secrets and Custom Resources
5. **Done** — AAP 2.6 accessible via OpenShift routes

### Containerized (SSH-based)

```
┌────────────────────────────────┐
│  AAP Deployment Wizard (App)   │
│  ┌──────────────────────────┐  │
│  │ React + PatternFly 6     │  │      SSH
│  │ 13-step guided wizard    │  │ ──────────────▶  Your RHEL 9 VM
│  └────────┬─────────────────┘  │                   ┌──────────────┐
│           │                    │                   │ AAP 2.6      │
│  ┌────────▼─────────────────┐  │                   │ • Gateway    │
│  │ Python FastAPI Backend   │  │                   │ • Controller │
│  │ (auto-started by app)    │  │                   │ • Hub        │
│  └──────────────────────────┘  │                   │ • EDA        │
└────────────────────────────────┘                   └──────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `./setup.sh` | First-time setup + launch |
| `./setup.sh --launch` | Launch (skip install) |
| `./setup.sh --test` | Run all tests |

## Wizard Steps

### OpenShift Flow (13 steps)

| # | Step | What You Configure |
|---|------|--------------------|
| 1 | Welcome | Overview + prerequisites |
| 2 | License Agreement | EULA acceptance |
| 3 | Cluster Connection | OpenShift API URL + bearer token → verifies connection |
| 4 | Namespace & Storage | Target namespace + storage class |
| 5 | AAP Operator | Operator channel + catalog source |
| 6 | Replicas & Resources | Component replica counts + resource presets |
| 7 | Database | Managed or external PostgreSQL |
| 8 | Routes & TLS | Route hostname + TLS termination mode |
| 9 | Admin Passwords | Gateway admin password |
| 10 | Advanced Variables | 170+ AAP CR configuration variables |
| 11 | Pre-flight Checks | Cluster validation (RBAC, nodes, storage) |
| 12 | Deploy | Live progress with streaming logs |
| 13 | Complete | Access URLs via OpenShift routes |

### Containerized Flow (13 steps)

| # | Step | What You Configure |
|---|------|--------------------|
| 1 | Welcome | Overview + prerequisites |
| 2 | License Agreement | EULA acceptance |
| 3 | Image Source | Online/disconnected + registry credentials + RH offline token |
| 4 | Topology | Growth or Enterprise (with sizing calculator) |
| 5 | SSH Target | SSH host, user, password → verifies connection |
| 6 | Hosts | Component FQDNs |
| 7 | Database | Managed or external PostgreSQL |
| 8 | Network & TLS | Ports, TLS settings |
| 9 | Admin Passwords | Admin passwords per component |
| 10 | Advanced Variables | 170+ installer variables |
| 11 | Pre-flight Checks | Auto-checks OS, RAM, CPU, disk, podman |
| 12 | Deploy | Live progress with streaming logs |
| 13 | Complete | Access URLs + next steps |

## Project Structure

```
aap_wizard_ocp/
├── setup.sh                  # One-command setup + launch
├── run.sh                    # Launch script (backend + frontend)
├── frontend/                 # Electron + React UI
│   ├── electron/             # Electron main process (starts backend)
│   ├── src/
│   │   ├── steps/            # 17 active wizard step components (shared across flows)
│   │   ├── components/       # Shared UI (ProfileManager, FormField, etc.)
│   │   ├── hooks/            # React hooks (store, validation, deploy)
│   │   ├── utils/            # Validators, formatters, crypto
│   │   └── __tests__/        # Frontend tests
│   └── package.json
├── backend/                  # Python FastAPI backend
│   ├── app/
│   │   ├── main.py           # API routes
│   │   ├── models.py         # Pydantic models
│   │   ├── deployer.py       # Containerized deployment engine (SSH + Ansible)
│   │   ├── ocp_deployer.py   # OCP deployment engine (operator-based)
│   │   ├── ocp_client.py     # OpenShift API client (httpx)
│   │   ├── ocp_preflight.py  # OCP-specific pre-flight checks
│   │   ├── cr_generator.py   # Custom Resource YAML generator
│   │   ├── inventory.py      # INI inventory generator (containerized mode)
│   │   ├── preflight.py      # Pre-flight system checks
│   │   ├── auth.py           # JWT authentication
│   │   ├── middleware.py     # Request middleware
│   │   └── services/         # 22 service modules (SSH, profiles, RH download, health, etc.)
│   ├── tests/                # 26 backend test files
│   └── requirements.txt
├── Dockerfile                # Container build (alternative to desktop)
├── CLAUDE.md                 # Claude Code guidance
└── LICENSE                   # MIT License
```

## Troubleshooting

### App won't start
```bash
# Check Python is available
python3 --version   # Need 3.10+

# Check Node is available
node --version      # Need 18+

# Re-run setup
./setup.sh
```

### "Cannot connect to cluster" (OCP mode)
- Verify the OpenShift API URL is reachable
- Ensure your bearer token has cluster-admin privileges
- Token can be retrieved via `oc whoami -t`

### "Cannot connect to target VM" (Containerized mode)
- Target VM must be reachable via SSH from your computer
- The SSH user needs sudo privileges
- Verify password is correct

### Backend not starting
```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
```

## Alternative: Docker (Not Currently Working)

> **Note:** The Docker/container image build has a known TypeScript compilation error and is not functional at this time. The recommended path is the **native desktop app** via `./setup.sh`, which auto-installs all dependencies and launches the Electron UI locally. If you're on a Mac or Linux machine with Node.js 18+ and Python 3.10+ installed, it should work out of the box with that single command.

```bash
# NOT WORKING — use ./setup.sh instead
docker build -t aap-wizard .
docker run -d -p 443:443 --name aap-wizard aap-wizard
```

## License

MIT License. See [LICENSE](LICENSE) for details.
