#!/usr/bin/env bash
set -euo pipefail

# ----------------------------------------------------------
# AAP Deployment Wizard — Azure Container Instances Deployment
# Update these variables for your environment
# ----------------------------------------------------------

RG="${AZURE_RESOURCE_GROUP:-your-resource-group}"
LOCATION="${AZURE_LOCATION:-eastus}"
ACR_NAME="${AZURE_ACR_NAME:-your-acr-name}"
IMAGE_NAME="aap-wizard"
CONTAINER_NAME="aap-wizard"
DNS_LABEL="${AZURE_DNS_LABEL:-aap-wizard}"
TAG="latest"

echo "==> Using resource group: $RG"

echo "==> Creating Azure Container Registry: $ACR_NAME"
az acr create --name "$ACR_NAME" --resource-group "$RG" --sku Basic --admin-enabled true --output none 2>/dev/null || echo "    (ACR already exists)"

echo "==> Building and pushing Docker image (this may take a few minutes)..."
cd "$(dirname "$0")/.."
az acr build \
  --registry "$ACR_NAME" \
  --resource-group "$RG" \
  --image "${IMAGE_NAME}:${TAG}" \
  --file Dockerfile.azure \
  .

echo "==> Deploying to Azure Container Instances..."
ACR_SERVER="${ACR_NAME}.azurecr.io"
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --resource-group "$RG" --query "passwords[0].value" -o tsv)

# Delete existing container if present
az container delete --resource-group "$RG" --name "$CONTAINER_NAME" --yes --output none 2>/dev/null || true

az container create \
  --resource-group "$RG" \
  --name "$CONTAINER_NAME" \
  --image "${ACR_SERVER}/${IMAGE_NAME}:${TAG}" \
  --registry-login-server "$ACR_SERVER" \
  --registry-username "$ACR_NAME" \
  --registry-password "$ACR_PASSWORD" \
  --os-type Linux \
  --cpu 1 \
  --memory 1.5 \
  --ports 443 \
  --ip-address Public \
  --dns-name-label "$DNS_LABEL" \
  --environment-variables JWT_SECRET="aap-wizard-$(openssl rand -hex 16)" \
  --output none

echo ""
echo "==> Deployment complete!"
FQDN=$(az container show --name "$CONTAINER_NAME" --resource-group "$RG" --query "ipAddress.fqdn" -o tsv)
IP=$(az container show --name "$CONTAINER_NAME" --resource-group "$RG" --query "ipAddress.ip" -o tsv)
echo "    URL:  https://${FQDN}"
echo "    IP:   https://${IP}"
echo ""
