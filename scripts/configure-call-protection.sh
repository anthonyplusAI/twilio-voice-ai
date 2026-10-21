#!/usr/bin/env bash
set -euo pipefail

# Run once before deploying the protected public workshop. The storage tables
# hold call reservations and analytics across Container App revisions; the
# admin password protects /admin routes. This uses the existing storage account.

WORKSHOP_RESOURCE_GROUP="${RG:-rg-voice-ai-workshop}"
WORKSHOP_CONTAINER_APP="${ACA:-voice-ai-workshop}"
WORKSHOP_STORAGE_ACCOUNT="${STORAGE:-voiceaiworkshop}"

command -v az >/dev/null 2>&1 || { echo "Azure CLI is required." >&2; exit 1; }
az account show -o none >/dev/null
az containerapp show -g "$WORKSHOP_RESOURCE_GROUP" -n "$WORKSHOP_CONTAINER_APP" -o none >/dev/null
az storage account show -g "$WORKSHOP_RESOURCE_GROUP" -n "$WORKSHOP_STORAGE_ACCOUNT" -o none >/dev/null

WORKSHOP_FQDN=$(az containerapp show -g "$WORKSHOP_RESOURCE_GROUP" \
  -n "$WORKSHOP_CONTAINER_APP" \
  --query properties.configuration.ingress.fqdn -o tsv)
if [ -z "$WORKSHOP_FQDN" ] || [ "$WORKSHOP_FQDN" = "None" ]; then
  echo "Container App has no public ingress FQDN." >&2
  exit 1
fi

WORKSHOP_ADMIN_SECRET=$(az containerapp secret list \
  -g "$WORKSHOP_RESOURCE_GROUP" -n "$WORKSHOP_CONTAINER_APP" \
  --query "[?name=='admin-password'].name | [0]" -o tsv)

if [ -n "${ADMIN_PASSWORD:-}" ]; then
  WORKSHOP_ADMIN_PASSWORD="$ADMIN_PASSWORD"
elif [ -n "$WORKSHOP_ADMIN_SECRET" ] && [ "$WORKSHOP_ADMIN_SECRET" != "None" ]; then
  WORKSHOP_ADMIN_PASSWORD=""
  echo "Existing admin password kept."
else
  if [ ! -t 0 ]; then
    echo "Set ADMIN_PASSWORD or run interactively to choose an admin password." >&2
    exit 1
  fi
  read -r -s -p "Choose an admin password (16+ characters): " WORKSHOP_ADMIN_PASSWORD
  echo
fi
if [ -n "$WORKSHOP_ADMIN_PASSWORD" ] && [ "${#WORKSHOP_ADMIN_PASSWORD}" -lt 16 ]; then
  echo "Admin password must be at least 16 characters." >&2
  exit 1
fi

echo "Configuring call protection for $WORKSHOP_CONTAINER_APP in $WORKSHOP_RESOURCE_GROUP."
WORKSHOP_TABLE_CONNECTION=$(az storage account show-connection-string \
  -g "$WORKSHOP_RESOURCE_GROUP" -n "$WORKSHOP_STORAGE_ACCOUNT" \
  --query connectionString -o tsv)
az storage table create -n CallLimits \
  --connection-string "$WORKSHOP_TABLE_CONNECTION" -o none
az storage table create -n AnalyticsEvents \
  --connection-string "$WORKSHOP_TABLE_CONNECTION" -o none
az containerapp secret set -g "$WORKSHOP_RESOURCE_GROUP" \
  -n "$WORKSHOP_CONTAINER_APP" \
  --secrets "call-limit-storage=$WORKSHOP_TABLE_CONNECTION" -o none
unset WORKSHOP_TABLE_CONNECTION

az containerapp secret set -g "$WORKSHOP_RESOURCE_GROUP" \
  -n "$WORKSHOP_CONTAINER_APP" \
  --secrets "public-base-url=https://$WORKSHOP_FQDN" -o none

if [ -n "$WORKSHOP_ADMIN_PASSWORD" ]; then
  az containerapp secret set -g "$WORKSHOP_RESOURCE_GROUP" \
    -n "$WORKSHOP_CONTAINER_APP" \
    --secrets "admin-password=$WORKSHOP_ADMIN_PASSWORD" -o none
  unset WORKSHOP_ADMIN_PASSWORD
fi

echo "CallLimits and AnalyticsEvents tables and Container App secrets are ready. Deploy the new app revision next."
