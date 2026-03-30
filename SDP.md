# AAP Unified Deployment Wizard — Software Development Plan

## Vision

The single fastest path from "I have an AAP subscription" to "I'm running automation."
One wizard that handles both Containerized (Podman/RHEL) and Operator (OpenShift) deployments
with AI-powered guidance, real-time validation, and guided post-install onboarding.

**Goal**: Beat every competitor's installation experience. Make AAP onboarding accessible
to sysadmins, DevOps engineers, and platform engineers regardless of their Ansible expertise.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│              Electron Desktop App                │
│  ┌───────────────────────────────────────────┐  │
│  │         React + PatternFly 6 UI           │  │
│  │                                           │  │
│  │  Welcome → Platform → Config → Deploy     │  │
│  │      ↓           ↓         ↓       ↓      │  │
│  │  Shared Steps  Branch   Merge   Results   │  │
│  └───────────────────────────────────────────┘  │
│                      │                           │
│  ┌───────────────────────────────────────────┐  │
│  │         FastAPI Backend (port 8000)        │  │
│  │                                           │  │
│  │  ┌─────────────┐  ┌──────────────────┐   │  │
│  │  │ Containerized│  │   OpenShift      │   │  │
│  │  │   Engine     │  │   Engine         │   │  │
│  │  │             │  │                  │   │  │
│  │  │ SSH+Ansible  │  │ K8s API+Operator │   │  │
│  │  │ INI Inventory│  │ YAML CR          │   │  │
│  │  └─────────────┘  └──────────────────┘   │  │
│  │                                           │  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │         Shared Services             │  │  │
│  │  │  Auth │ AI Debugger │ Preflight     │  │  │
│  │  │  Audit│ Onboarding  │ Health Check  │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Wizard Step Flow

### Shared Steps (Both Platforms)
```
1.  Welcome           — Hero page, platform picker preview, past deployments
2.  EULA               — License agreement acceptance
3.  Platform Choice    — NEW: Containerized vs OpenShift (visual comparison)
```

### Containerized Branch (Existing + Enhanced)
```
4c. Installation Type  — Online / Disconnected + install directory
5c. Topology           — Growth (AIO) / Enterprise + sizing calculator
6c. SSH Target         — Host, port, user, password + verify connection
7c. Hosts              — Component-to-host mapping
```

### OpenShift Branch (New)
```
4o. Cluster Connection — OCP API URL + token/kubeconfig + verify
5o. Namespace & Storage— Namespace, storage class, PVC sizes
6o. Operator Install   — Install AAP Operator from OperatorHub
7o. Replicas & Scaling — Per-component replica counts + resource limits
```

### Merged Steps (Both Platforms, Adaptive UI)
```
8.  Components         — Gateway, Controller, Hub, EDA config
9.  Database           — Managed vs External PostgreSQL
10. Network            — Ports/Routes, TLS, certificates
11. Credentials        — Admin passwords (shared or per-component)
12. Advanced Variables — All installer/CR variables with doc links
13. Preflight Checks   — Platform-aware validation
14. Review             — Full config summary + INI/CR preview
15. Deploy             — Live progress with AI diagnosis
16. Complete           — Access details + deployment history
17. Onboarding         — NEW: Guided first-use walkthrough
```

---

## New Features (Competitive Differentiators)

### 1. Platform Choice Step
Visual side-by-side comparison of Containerized vs OpenShift with:
- Animated topology diagrams
- "Which is right for me?" decision helper
- Hardware/cluster requirement comparison
- Time-to-deploy estimates

### 2. OpenShift Cluster Connection
- Paste `oc login` command or API URL + token
- Upload kubeconfig file
- Auto-detect cluster version, nodes, storage classes
- Verify cluster-admin RBAC
- Show cluster health summary (nodes, capacity, existing operators)

### 3. Operator Lifecycle Management
- Check if AAP Operator is already installed
- Install from OperatorHub with progress tracking
- Show operator pod status and readiness
- Handle operator upgrades

### 4. CR Generator
- Convert wizard config → AnsibleAutomationPlatform CR (YAML)
- Full spec coverage matching operator capabilities
- Preview with syntax highlighting
- Download/copy CR for GitOps workflows

### 5. Guided Onboarding (Post-Install) — NEW
After deployment completes, walk the user through:
- Step 1: Upload subscription manifest (with link + instructions)
- Step 2: Create first project (connect a Git repo)
- Step 3: Create inventory (add managed hosts)
- Step 4: Create job template
- Step 5: Launch first job
- Step 6: Set up EDA webhook
Each step has a "Do it for me" button that calls the AAP API.

### 6. AI Co-Pilot (Enhanced)
- Pre-deployment: "Review my config" — AI analyzes for issues
- During deployment: Auto-diagnose failures with fix suggestions
- Post-deployment: "What should I do next?" context-aware guidance
- Natural language config: "I want HA with 3 controller nodes" → auto-configure

### 7. Environment Profiles
- Save named profiles: "Dev", "Staging", "Production"
- Import/export profiles as JSON
- Share profiles across team (export includes sanitized config)
- Template library: pre-built configs for common scenarios

### 8. Multi-Language Support
- i18n framework for UI strings
- Start with English, structure for Japanese, Korean, Chinese, Spanish

---

## Backend API Routes

### Existing (Containerized)
```
POST   /api/auth/login
GET    /api/health
POST   /api/ssh/verify
POST   /api/ports/check
POST   /api/preflight
POST   /api/prepare
POST   /api/config/validate
POST   /api/inventory/generate
POST   /api/deploy/start
GET    /api/deploy/{session_id}/status
POST   /api/deploy/{session_id}/cancel
WS     /api/deploy/{session_id}/ws
POST   /api/ai/diagnose
```

### New (OpenShift)
```
POST   /api/ocp/connect          — Verify OCP cluster connection
GET    /api/ocp/cluster-info     — Get cluster version, nodes, storage
GET    /api/ocp/operators        — List installed operators
POST   /api/ocp/operator/install — Install AAP Operator
GET    /api/ocp/operator/status  — Get operator status
POST   /api/ocp/cr/generate      — Generate AAP CR YAML
POST   /api/ocp/cr/validate      — Validate CR against schema
POST   /api/ocp/deploy/start     — Apply CR and start deployment
GET    /api/ocp/deploy/{id}/status — Watch operator reconciliation
POST   /api/ocp/preflight        — OCP-specific preflight checks
GET    /api/ocp/routes            — Get created routes/URLs
```

### New (Onboarding)
```
POST   /api/onboard/manifest     — Upload subscription manifest
POST   /api/onboard/project      — Create first project
POST   /api/onboard/inventory    — Create inventory + hosts
POST   /api/onboard/template     — Create job template
POST   /api/onboard/launch       — Launch first job
GET    /api/onboard/status       — Get onboarding progress
```

---

## File Structure (New/Modified)

```
aap_wizard_ocp/
├── backend/
│   ├── app/
│   │   ├── main.py              — Add OCP + onboarding routes
│   │   ├── deployer.py          — Existing containerized engine
│   │   ├── ocp_deployer.py      — NEW: OpenShift deployment engine
│   │   ├── ocp_client.py        — NEW: Kubernetes API wrapper
│   │   ├── cr_generator.py      — NEW: YAML CR generator
│   │   ├── ocp_preflight.py     — NEW: OCP cluster checks
│   │   ├── onboarding.py        — NEW: Post-install API calls
│   │   ├── inventory.py         — Existing INI generator
│   │   ├── preflight.py         — Existing SSH checks
│   │   ├── auth.py              — Existing JWT auth
│   │   └── services/
│   │       ├── ssh_service.py
│   │       ├── ai_service.py    — Enhanced AI co-pilot
│   │       └── audit_service.py
│   └── requirements.txt         — Add: kubernetes, openshift-client
│
├── frontend/
│   └── src/
│       ├── steps/
│       │   ├── WelcomeStep.tsx        — Enhanced with platform preview
│       │   ├── EulaStep.tsx           — Unchanged
│       │   ├── PlatformStep.tsx       — NEW: Containerized vs OCP
│       │   ├── SubscriptionStep.tsx   — Unchanged (containerized)
│       │   ├── ClusterStep.tsx        — NEW: OCP cluster connection
│       │   ├── NamespaceStep.tsx      — NEW: Namespace + storage
│       │   ├── OperatorStep.tsx       — NEW: Operator install/status
│       │   ├── ReplicasStep.tsx       — NEW: Scaling config
│       │   ├── TopologyStep.tsx       — Unchanged (containerized)
│       │   ├── TargetStep.tsx         — Unchanged (containerized)
│       │   ├── HostsStep.tsx          — Unchanged (containerized)
│       │   ├── ComponentsStep.tsx     — Minor: adapt for both modes
│       │   ├── DatabaseStep.tsx       — Minor: add storage class (OCP)
│       │   ├── NetworkStep.tsx        — Add: OCP Routes config
│       │   ├── CredentialsStep.tsx    — Unchanged
│       │   ├── AdvancedVariablesStep.tsx — Add: CR overrides for OCP
│       │   ├── PreflightStep.tsx      — Platform-aware checks
│       │   ├── ReviewStep.tsx         — Show INI or CR based on mode
│       │   ├── DeployStep.tsx         — Add: operator watch mode
│       │   ├── CompleteStep.tsx       — Add: Route URLs for OCP
│       │   └── OnboardingStep.tsx     — NEW: Guided first-use
│       ├── types.ts                   — Add OCP types
│       ├── api.ts                     — Add OCP API calls
│       └── App.tsx                    — Updated step flow with branching
```

---

## Implementation Phases

### Phase 1: Foundation (Core Architecture)
- [ ] Platform selection step with visual comparison
- [ ] Step branching logic in App.tsx (containerized vs OCP paths)
- [ ] Updated types.ts with OCP config types
- [ ] Updated api.ts with OCP endpoints
- [ ] Basic OCP cluster connection step (UI only)

### Phase 2: OCP Backend Engine
- [ ] ocp_client.py — Kubernetes API wrapper
- [ ] ocp_deployer.py — Operator install + CR apply + watch
- [ ] cr_generator.py — Config → YAML CR conversion
- [ ] ocp_preflight.py — Cluster validation checks
- [ ] New API routes in main.py

### Phase 3: OCP Frontend Steps
- [ ] ClusterStep.tsx — OCP connection + verification
- [ ] NamespaceStep.tsx — Namespace + storage class selection
- [ ] OperatorStep.tsx — Operator install with progress
- [ ] ReplicasStep.tsx — Per-component scaling
- [ ] Modified shared steps for OCP mode

### Phase 4: Post-Install Onboarding
- [ ] OnboardingStep.tsx — Guided walkthrough UI
- [ ] onboarding.py — AAP API integration
- [ ] "Do it for me" automation for each onboarding step
- [ ] Progress tracking and skip options

### Phase 5: Polish & Competitive Edge
- [ ] AI co-pilot enhancements
- [ ] Environment profiles (save/load/share)
- [ ] Animated topology diagrams
- [ ] i18n framework
- [ ] Comprehensive test coverage
- [ ] Documentation and README update

---

## Tech Stack Additions

| Package | Purpose | Security |
|---------|---------|----------|
| `kubernetes` (Python) | K8s API client | Official CNCF, widely used |
| `openshift-client` (Python) | OCP-specific extensions | Red Hat maintained |
| `pyyaml` | CR YAML generation | Already in deps |
| `@patternfly/react-topology` | Topology diagrams | Red Hat maintained |

---

## Security Considerations

- OCP tokens stored in sessionStorage only (same as SSH passwords)
- Kubeconfig files read but never persisted
- CR YAML never includes secrets in preview (masked)
- All API calls require JWT auth (existing)
- No cluster credentials in localStorage or deployment records
- RBAC: wizard warns if token lacks cluster-admin
