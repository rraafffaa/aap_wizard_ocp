# AAP Deployment Wizard — End-to-End Test Plan

**Application URL:** https://aap-wizard.eastus.cloudapp.azure.com
**Target VM:** 192.0.2.10 (rafeal / REDACTED_PASSWORD)
**Date:** 2026-03-20

---

## Test Matrix

### Deployment Combinations

| # | Topology | Install Type | Database | TLS | Redis | Status |
|---|----------|-------------|----------|-----|-------|--------|
| T1 | Growth | Online | Managed | Self-signed | Standalone | PRIMARY |
| T2 | Growth | Online | Managed | Disabled | Standalone | |
| T3 | Growth | Online | Managed | Self-signed | Standalone | Dry Run |
| T4 | Growth | Disconnected | Managed | Self-signed | Standalone | Inventory only* |
| T5 | Enterprise | Online | Managed | Self-signed | Standalone | Inventory only* |
| T6 | Enterprise | Online | External | Self-signed | Cluster | Inventory only* |

*Inventory-only tests validate the generated inventory file without actual deployment (requires multiple VMs or bundle).

### Feature Tests

| # | Feature | Test |
|---|---------|------|
| F1 | Login | Valid Red Hat Registry credentials → JWT issued |
| F2 | Login | Invalid credentials → 401 rejected |
| F3 | Login | Rate limiting → 11 rapid attempts → 429 |
| F4 | SSH Verify | Connect to target VM → returns hostname + OS |
| F5 | SSH Verify | Bad password → returns error |
| F6 | Port Check | Verify ports 443, 80, 27199 on target |
| F7 | Preflight | Run preflight checks on target |
| F8 | Auto-Prepare | Install dependencies on target |
| F9 | AI Diagnosis | Submit error logs → get diagnosis |
| F10 | Inventory Gen | Generate inventory for each topology |
| F11 | Inventory Validate | Validate config catches missing fields |
| F12 | Config Import/Export | Export JSON, re-import |
| F13 | Session Resume | Refresh page → resume prompt appears |
| F14 | Dry Run | Run dry-run deploy → completes without install |
| F15 | Full Deploy | Growth + Online → AAP accessible at target |
| F16 | Security Headers | Check response headers for HSTS, X-Frame-Options |
| F17 | WebSocket Auth | WS without token → rejected |
| F18 | Password Quoting | Passwords with #, =, spaces work in inventory |

---

## Test Procedures

### T1: Growth + Online + Full Deploy (PRIMARY TEST)

**Pre-conditions:**
- Target VM running: 192.0.2.10
- Valid Red Hat Registry credentials

**Steps:**
1. Navigate to https://aap-wizard.eastus.cloudapp.azure.com
2. Accept browser security warning (self-signed cert)
3. Login with Red Hat Registry credentials
4. Welcome → click Next
5. EULA → Accept → Next
6. Subscription → defaults (online) → Next
7. Topology → Growth (All-in-One) → Next
8. Target → Enter: IP=192.0.2.10, User=rafeal, Password=REDACTED_PASSWORD → Verify Connection → Next
9. Hosts → defaults (all components on same host) → Next
10. Components → defaults → Next
11. Database → Managed, set admin password → Next
12. Network → defaults (443/80, self-signed TLS) → Next
13. Credentials → set all admin passwords, set component pg_passwords → Next
14. Advanced Variables → defaults → Next
15. Preflight → Run checks → Next
16. Review → verify all settings, check inventory preview → Start Deployment
17. Deploy → monitor phases, wait for completion
18. Complete → verify access URL works

**Expected Results:**
- All 8 phases complete (validate → complete)
- No errors in deployment log
- AAP accessible at https://192.0.2.10:443
- Gateway login page visible

**Known Issues to Watch:**
- ee-minimal/ee-supported image pull timeout → auto-retry should handle
- /home disk space → auto-prepare relocates to /opt
- FQDN resolution → deployer uses hostname -f

### F16: Security Headers Test

```bash
curl -sI https://aap-wizard.eastus.cloudapp.azure.com/api/health | grep -i 'x-content-type\|x-frame\|strict-transport\|x-xss\|referrer-policy'
```

**Expected:**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### F18: Password Quoting Test

Verify passwords with special characters (e.g., `P@ss#word=1 2`) generate valid inventory:
- `#` should not be treated as a comment
- `=` should not split the key-value pair
- Spaces should not break parsing

---

## Bugs Fixed Before Testing

| # | Bug | File | Fix |
|---|-----|------|-----|
| B1 | `ansible_connection=local` conflicts with SSH vars | inventory.py | Only set `ansible_become_password` for remote growth |
| B2 | Passwords with special chars break INI inventory | inventory.py | Added `_quote_ini()` method |
| B3 | `--force` missing deps for collection install | deployer.py | Changed to `--force-with-deps` |
| B4 | ee-minimal/ee-supported timeout during install | deployer.py | Added pre-pull step in prepare phase |
| B5 | registry_password not quoted | inventory.py | Applied `_quote_ini()` |
| B6 | Hardcoded API key in ai_debugger.py | ai_debugger.py | Moved to env var |
| B7 | Hardcoded JWT secret | auth.py | Auto-generated ephemeral secret |
| B8 | CORS allows localhost | main.py | No default origins |
| B9 | XSS via dangerouslySetInnerHTML | DeployStep.tsx | Safe React rendering |
| B10 | No security headers | middleware.py | Added SecurityHeadersMiddleware |
| B11 | WebSocket no auth | main.py | JWT required via query param |
| B12 | TLS cert baked in Docker image | Dockerfile.azure | Runtime generation |

---

## Infrastructure

| Resource | Type | Size | IP | Purpose |
|----------|------|------|----|---------|
| aap-wizard-vm | VM | B2s | 192.0.2.20 | Hosts the wizard app |
| aap-wizard-demo | VM | D4s_v3 | 192.0.2.10 | AAP deployment target |
| aap-wizard-ai | Azure OpenAI | S0 | - | AI error diagnosis |
| your-acr-name | Container Registry | Basic | - | Docker image storage |

**NSG Rules (aap-nsg):**
- SSH (22): Admin IP only (192.0.2.30/32)
- HTTPS (443): Open (app has JWT auth)
- All other inbound: DENY
