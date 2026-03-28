# AAP Wizard Demo Playbooks

End-to-end playbooks to provision an Azure VM, deploy AAP 2.6, and set up Azure AI Foundry for Ansible Lightspeed (ALIA).

## Prerequisites

```bash
# Azure CLI
brew install azure-cli    # macOS
az login

# Ansible collections
pip install azure-identity azure-mgmt-resource azure-mgmt-compute azure-mgmt-network azure-mgmt-cognitiveservices
ansible-galaxy collection install azure.azcollection community.general ansible.posix

# SSH key (if you don't have one)
ssh-keygen -t rsa -b 4096
```

## Configuration

Edit `group_vars/all.yml` with your values:
- Azure region, VM size, resource group name
- AAP registry credentials (from access.redhat.com)
- AI Foundry model preferences

For secrets, create `group_vars/vault.yml`:
```bash
ansible-vault create playbooks/group_vars/vault.yml
```
```yaml
vault_registry_username: "your-rhn-username"
vault_registry_password: "your-rhn-password"
vault_aap_admin_password: "StrongPassword!2026"
vault_pg_password: "PgStrongPass!2026"
```

## Run Order

### Step 1: Provision Azure VM
```bash
ansible-playbook playbooks/01-provision-azure-vm.yml
```
Creates a RHEL 9.4 VM (Standard_D4s_v3: 4 vCPU, 16 GB RAM, 100 GB data disk) with all ports opened and packages installed.

### Step 2: Deploy AAP 2.6
```bash
ansible-playbook -i playbooks/inventory_azure.ini playbooks/02-deploy-aap.yml
```
Copies the AAP installer bundle, generates an inventory, and runs the containerized installer.

### Step 3: Set up AI Foundry for ALIA
```bash
ansible-playbook playbooks/03-setup-ai-foundry.yml
```
Creates an Azure AI Services account, deploys GPT-4o, and outputs the endpoint/key for Ansible Lightspeed.

### Or: Use the Wizard
After Step 1, you can use the AAP Deployment Wizard desktop app instead of Step 2:
1. Launch the wizard: `cd frontend && npm run electron:dev`
2. Enter the VM IP from Step 1 in the SSH Target step
3. Walk through the wizard and click Deploy

## Files Created During Run

- `inventory_azure.ini` -- Generated inventory with the VM IP
- `ai_foundry_config.env` -- AI Foundry endpoint and API key
