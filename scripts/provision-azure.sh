#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════════════════════
# One-time Azure + GitHub provisioning for the OIDC deploy pipeline.
#
#   az login        # log into the RIGHT subscription
#   gh auth status  # and authenticated to GitHub
#   ./scripts/provision-azure.sh
#
# Idempotent. Creates the Azure resources (incl. the existing Azure Files share),
# the OIDC federated credential, and the GitHub
# vars/secrets the deploy reads. Adopts existing resources rather than inventing
# names. Mirrors docs/INFRA_SETUP.md.
# ════════════════════════════════════════════════════════════════════════════

# ---- Config (edit if your resource names differ) ----------------------------
RG="${RG:-rg-voice-ai-workshop}"
LOCATION="${LOCATION:-centralus}"
ACR="${ACR:-voiceaiworkshop}"            # ACR name (globally unique, alnum)
ACA_ENV="${ACA_ENV:-voiceaiworkshop}"
ACA="${ACA:-voice-ai-workshop}"
STORAGE="${STORAGE:-voiceaiworkshop}"    # file-share and call-limit table storage account
FILE_SHARE="${FILE_SHARE:-voiceaidata}"
LAW="${LAW:-law-voiceaiworkshop}"
TAGS=(created_by=github-actions managed_by=voice-ai-workshop-ci)
# ----------------------------------------------------------------------------

require() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' not installed." >&2; exit 1; }; }
require az
require gh

echo "==> Checking logins..."
az account show >/dev/null 2>&1 || { echo "Not logged into Azure. Run: az login" >&2; exit 1; }
gh auth status  >/dev/null 2>&1 || { echo "Not logged into GitHub. Run: gh auth login" >&2; exit 1; }

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)

# DETECT-DON'T-INVENT: adopt existing resources in the RG.
if az group show -n "$RG" -o none 2>/dev/null; then
  EXISTING_ACR=$(az acr list -g "$RG" --query "[0].name" -o tsv 2>/dev/null)
  [ -n "$EXISTING_ACR" ] && [ "$EXISTING_ACR" != "$ACR" ] && { echo "  !! Adopting existing ACR '$EXISTING_ACR'"; ACR="$EXISTING_ACR"; }
  EXISTING_ACA=$(az containerapp list -g "$RG" --query "[0].name" -o tsv 2>/dev/null)
  [ -n "$EXISTING_ACA" ] && [ "$EXISTING_ACA" != "$ACA" ] && { echo "  !! Adopting existing Container App '$EXISTING_ACA'"; ACA="$EXISTING_ACA"; }
  EXISTING_STORAGE=$(az storage account list -g "$RG" --query "[0].name" -o tsv 2>/dev/null)
  [ -n "$EXISTING_STORAGE" ] && [ "$EXISTING_STORAGE" != "$STORAGE" ] && { echo "  !! Adopting existing storage '$EXISTING_STORAGE'"; STORAGE="$EXISTING_STORAGE"; }
fi

echo "    GitHub repo:        $REPO"
echo "    Azure subscription: $SUB"
echo "    Resource group:     $RG ($LOCATION)"
echo "    Container Registry: $ACR | Container App: $ACA"
echo "    Storage/File share: $STORAGE / $FILE_SHARE"
echo ""
read -r -p "Proceed with provisioning into the above subscription? [y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "Aborted."; exit 0; }

echo "==> [1/7] Resource group..."
az group create -n "$RG" -l "$LOCATION" --tags "${TAGS[@]}" -o none

echo "==> [2/7] Container Registry (no admin user — OIDC pulls)..."
az acr show -n "$ACR" -g "$RG" -o none 2>/dev/null \
  || az acr create -n "$ACR" -g "$RG" --sku Basic --tags "${TAGS[@]}" -o none

echo "==> [3/7] Storage account + file share..."
az storage account show -n "$STORAGE" -g "$RG" -o none 2>/dev/null \
  || az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" --sku Standard_LRS --tags "${TAGS[@]}" -o none
STORAGE_KEY=$(az storage account keys list -g "$RG" --account-name "$STORAGE" --query '[0].value' -o tsv)
az storage share create --name "$FILE_SHARE" --account-name "$STORAGE" --account-key "$STORAGE_KEY" --quota 10 -o none 2>/dev/null || true

echo "==> [4/7] Log Analytics workspace (tagged) + Container Apps env..."
az monitor log-analytics workspace show -g "$RG" -n "$LAW" -o none 2>/dev/null \
  || az monitor log-analytics workspace create -g "$RG" -n "$LAW" -l "$LOCATION" --tags "${TAGS[@]}" -o none
LAW_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW" --query customerId -o tsv)
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys -g "$RG" -n "$LAW" --query primarySharedKey -o tsv)
az containerapp env show -n "$ACA_ENV" -g "$RG" -o none 2>/dev/null \
  || az containerapp env create -n "$ACA_ENV" -g "$RG" -l "$LOCATION" \
       --logs-destination log-analytics --logs-workspace-id "$LAW_ID" --logs-workspace-key "$LAW_KEY" \
       --tags "${TAGS[@]}" -o none

echo "==> [5/7] Register the Azure Files mount on the env (named 'appdata')..."
az containerapp env storage set --name "$ACA_ENV" -g "$RG" \
  --storage-name appdata --azure-file-account-name "$STORAGE" \
  --azure-file-account-key "$STORAGE_KEY" --azure-file-share-name "$FILE_SHARE" \
  --access-mode ReadWrite -o none

echo "==> [6/7] Container App (placeholder image; deploy applies the manifest)..."
az containerapp show -n "$ACA" -g "$RG" -o none 2>/dev/null \
  || az containerapp create -n "$ACA" -g "$RG" --environment "$ACA_ENV" \
       --image mcr.microsoft.com/k8se/quickstart:latest \
       --target-port 8080 --ingress external --min-replicas 1 --max-replicas 1 \
       --tags "${TAGS[@]}" -o none

echo "==> [7/7] Service principal + OIDC federated credential + GitHub config..."
APP_ID=$(az ad app list --display-name "$ACA-gha-deploy" --query '[0].appId' -o tsv)
[ -z "$APP_ID" ] && APP_ID=$(az ad app create --display-name "$ACA-gha-deploy" --query appId -o tsv)
az ad sp show --id "$APP_ID" -o none 2>/dev/null || az ad sp create --id "$APP_ID" -o none
az role assignment create --assignee "$APP_ID" --role AcrPush --scope "$(az acr show -n "$ACR" --query id -o tsv)" -o none 2>/dev/null || true
az role assignment create --assignee "$APP_ID" --role Contributor --scope "$(az group show -n "$RG" --query id -o tsv)" -o none 2>/dev/null || true
OIDC_SUBJECT="repo:${REPO}:ref:refs/heads/main"
CURRENT_OIDC_SUBJECT=$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='gha-main'].subject | [0]" -o tsv)
if [ -z "$CURRENT_OIDC_SUBJECT" ]; then
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\":\"gha-main\",\"issuer\":\"https://token.actions.githubusercontent.com\",
    \"subject\":\"${OIDC_SUBJECT}\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none
elif [ "$CURRENT_OIDC_SUBJECT" != "$OIDC_SUBJECT" ]; then
  echo "    Updating OIDC subject: $CURRENT_OIDC_SUBJECT -> $OIDC_SUBJECT"
  az ad app federated-credential update --id "$APP_ID" --federated-credential-id gha-main --parameters "{
    \"issuer\":\"https://token.actions.githubusercontent.com\",
    \"subject\":\"${OIDC_SUBJECT}\",\"audiences\":[\"api://AzureADTokenExchange\"]}" -o none
fi

gh variable set ACR_NAME --body "$ACR"
gh variable set ACA_NAME --body "$ACA"
gh variable set ACA_RESOURCE_GROUP --body "$RG"
gh secret set AZURE_CLIENT_ID --body "$APP_ID"
gh secret set AZURE_TENANT_ID --body "$TENANT"
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUB"

ensure_secret() {
  local name="$1" prompt="$2"
  if gh secret list --json name -q '.[].name' | grep -qx "$name"; then
    echo "    $name already set — leaving as-is."
  else
    read -r -s -p "    Enter $prompt (Enter to skip): " val; echo
    [ -n "$val" ] && gh secret set "$name" --body "$val" || echo "    (skipped $name)"
  fi
}
ensure_secret TWILIO_ACCOUNT_SID "Twilio Account SID"
ensure_secret TWILIO_AUTH_TOKEN "Twilio Auth Token"
ensure_secret TWILIO_PHONE_NUMBER "Twilio phone number"
ensure_secret OPENAI_API_KEY "OpenAI API key"
ensure_secret WORKSHOP_SLIDES_EMBED_URL "Workshop slides embed URL"
ensure_secret HANDOFF_PHONE_NUMBER "Handoff phone number"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Provisioning complete."
echo "    gh workflow run deploy.yml      # then watch 'Smoke test /health'"
echo "    gh secret delete AZURE_CREDENTIALS   # once a deploy is green"
echo "════════════════════════════════════════════════════════════════"
