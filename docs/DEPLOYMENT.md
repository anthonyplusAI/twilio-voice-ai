# Deployment

The app deploys to **Azure Container Apps** via `.github/workflows/deploy.yml`,
gated behind CI. Auth is OIDC — no stored cloud credentials.

## How it works

Every push to `main` (or a manual **Run workflow**) runs three jobs:

1. **`ci`** — reuses `.github/workflows/ci.yml` (the `Validate` gate: lint, typecheck, `next build`, the integration tests, gitleaks, dependency-review). Red CI ⇒ build + deploy skipped.
2. **`build-and-push`** — OIDC login → Buildx build (gha cache) → push a SHA-tagged image to ACR.
3. **`deploy`** — OIDC login → sync app secrets (skip-on-unset) → check the three call-protection secrets → apply `.github/containerapp.yaml` (image injected via `envsubst`) → poll `GET /health` until 200.

`concurrency: deploy-prod` with `cancel-in-progress: false` ensures a prod deploy is never cancelled mid-update.

## State / data

The per-number Call Me limits live in the existing storage account's `CallLimits` Azure Table. The table is shared by Container App revisions, so a deploy does not reset active-call reservations or the rolling 60-minute counts.

Workshop analytics use local SQLite at `data/analytics.db` inside the container and reset when it is replaced. The `voiceaidata` Azure Files share is still mounted at `/app/appdata`, but analytics do not use it because SQLite locking is unreliable on that mount.

## Prerequisites

One-time Azure provisioning + GitHub vars/secrets: run `./scripts/provision-azure.sh` (after `az login`) — see **[INFRA_SETUP.md](./INFRA_SETUP.md)**. Before deploying this version, run `./scripts/configure-call-protection.sh` to create `CallLimits` and set the Container App secrets for the table, organizer password, and `PUBLIC_BASE_URL`. The production call route requires the table connection and public HTTPS origin; `/admin` requires the password.

The public Call Me button allows one active call and ten started calls per number in a rolling 60 minutes, for valid US or Canadian destinations. This applies to both the hosted Explorer agent and Builder calls routed to an attendee's Codespace. The site fetches and checks the Builder's current `/twiml` response on each call, then sends the supported ConversationRelay settings to Twilio. It also checks the guided `/call-ended` response before any live handoff, allowing only one US or Canadian destination. Saved `workshop/server.js` changes are used on the next call.

The dedicated site's Twilio account should also allow only low-risk **United States/Canada** dialing in [Voice geographic permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources). This account setting is outside the app deploy and should be checked whenever the Twilio credentials change.

## Rollback

Re-run the deploy from a previous green commit (each image is SHA-tagged in ACR), or:
```bash
# edit containerapp.yaml's image, or:
az containerapp update -n voice-ai-workshop -g rg-voice-ai-workshop \
  --image voiceaiworkshop.azurecr.io/voice-ai-workshop:<previous-sha>
```

## Health

`GET /health` → `{"status":"ok","uptime":<seconds>}` — unauthenticated, no dependency. This is the route taught in chapter-6; the deploy smoke-tests it.

The health check does not place a Twilio call. After deployment, make a test Explorer call and a Builder call from a running Codespace to check the live phone paths.
