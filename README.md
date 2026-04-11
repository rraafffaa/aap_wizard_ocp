# AAP Deployment Wizard

A native desktop application for deploying **Red Hat Ansible Automation Platform 2.6** containerized installations. Replaces manual inventory file editing with a guided PatternFly UI — like a setup wizard for AAP.

![Electron](https://img.shields.io/badge/Electron-35-blue) ![React](https://img.shields.io/badge/React-18-blue) ![Python](https://img.shields.io/badge/Python-3.12-green) ![PatternFly](https://img.shields.io/badge/PatternFly-6-red)

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/rraafffaa/aap_wizard-prod.git
cd aap_wizard-prod

# 2. Run setup (installs everything + launches the app)
./setup.sh
```

That's it. The desktop app opens automatically.

## What You Need

| Requirement | How to Get It |
|-------------|---------------|
| **Python 3.10+** | `brew install python3` or [python.org](https://www.python.org/downloads/) |
| **Node.js 18+** | `brew install node` or [nodejs.org](https://nodejs.org/) |
| **Red Hat Registry credentials** | Your `rh-ee-*` username + password from [access.redhat.com](https://access.redhat.com) |
| **A RHEL 9 target VM** | SSH access with sudo privileges (the machine where AAP gets installed) |

The AAP installer tarball is **already included** in this repo — no separate download needed.

## How It Works

```
┌────────────────────────────────┐
│  AAP Deployment Wizard (App)   │
│  ┌──────────────────────────┐  │
│  │ React + PatternFly 6     │  │      SSH
│  │ 15-step guided wizard    │  │ ──────────────▶  Your RHEL 9 VM
│  └────────┬─────────────────┘  │                   ┌──────────────┐
│           │                    │                   │ AAP 2.6      │
│  ┌────────▼─────────────────┐  │                   │ • Gateway    │
│  │ Python FastAPI Backend   │  │                   │ • Controller │
│  │ (auto-started by app)    │  │                   │ • Hub        │
│  └──────────────────────────┘  │                   │ • EDA        │
└────────────────────────────────┘                   └──────────────┘
```

1. **Open the app** — Backend starts automatically
2. **Enter your Red Hat credentials** — Registry login
3. **Follow the wizard** — Target VM, topology, passwords, etc.
4. **Click Deploy** — The app SSHes into your VM and installs AAP
5. **Done** — AAP 2.6 accessible on your target VM

## Commands

| Command | Description |
|---------|-------------|
| `./setup.sh` | First-time setup + launch |
| `./setup.sh --launch` | Launch (skip install) |
| `./setup.sh --test` | Run all tests |

## Deployment Topologies

| Topology | Description | VMs |
|----------|-------------|-----|
| **Growth** | All components on one host | 1 |
| **Enterprise** | Multi-node deployment | 2+ |

Both support **online** (pulls from registry.redhat.io) and **disconnected** (bundled tarball) installations.

## Wizard Steps

| # | Step | What You Configure |
|---|------|--------------------|
| 1 | Welcome | Overview + prerequisites |
| 2 | EULA | License acceptance |
| 3 | Subscription | Online/disconnected + registry credentials |
| 4 | Topology | Growth or Enterprise |
| 5 | Target | SSH host, user, password → verifies connection |
| 6 | Hosts | Component FQDNs |
| 7 | Components | Gateway, Controller, Hub, EDA options |
| 8 | Database | Managed or external PostgreSQL |
| 9 | Network | Ports, TLS settings |
| 10 | Credentials | Admin passwords per component |
| 11 | Advanced | 170+ installer variables |
| 12 | Preflight | Auto-checks OS, RAM, CPU, disk, podman |
| 13 | Review | Final review + inventory preview |
| 14 | Deploy | Live progress with streaming logs |
| 15 | Complete | Access URLs + next steps |

## Project Structure

```
aap_wizard/
├── setup.sh                  # One-command setup + launch
├── frontend/                 # Electron + React UI
│   ├── electron/             # Electron main process (starts backend)
│   ├── src/
│   │   ├── steps/            # 15 wizard step components
│   │   ├── components/       # Shared UI (LoginPage, FormField, etc.)
│   │   ├── hooks/            # React hooks (store, validation, deploy)
│   │   ├── utils/            # Validators, formatters, crypto
│   │   └── __tests__/        # Frontend tests
│   └── package.json
├── backend/                  # Python FastAPI backend
│   ├── app/
│   │   ├── main.py           # API routes
│   │   ├── deployer.py       # Deployment engine (SSH + Ansible)
│   │   ├── inventory.py      # INI inventory generator
│   │   ├── preflight.py      # Pre-flight system checks
│   │   ├── auth.py           # JWT authentication
│   │   └── services/         # SSH, ports, AI debugger, audit
│   ├── tests/                # 21 backend test files
│   └── requirements.txt
├── ansible-automation-platform-containerized-setup-2.6-6.tar.gz  # Bundled
├── Dockerfile                # Container build (alternative to desktop)
├── CLAUDE.md                 # Claude Code guidance
└── TEST_PLAN.md              # Full test documentation
```

## Using Claude Code with This Repo

This repo includes a `CLAUDE.md` file. If you use [Claude Code](https://claude.com/claude-code), it will automatically understand the project structure, how to run tests, and how to make changes. Just ask it:

- *"Run the tests"*
- *"Add a new wizard step for X"*
- *"Fix the SSH connection issue"*
- *"Deploy to a new VM at 10.0.0.5"*

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

### "Cannot connect to target VM"
- Target VM must be reachable via SSH from your computer
- The SSH user needs sudo privileges
- Verify password is correct

### "/home disk space" warning
The wizard auto-detects small `/home` partitions and moves storage to `/opt`. No action needed.

### Backend not starting
```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
```

## Alternative: Docker

If you prefer running as a container instead of a desktop app:

```bash
# Build and run
docker build -t aap-wizard .
docker run -d -p 443:443 --name aap-wizard aap-wizard

# Open https://localhost in your browser
```

## License

MIT License. See [LICENSE](LICENSE) for details.
