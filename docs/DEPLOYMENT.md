# Deployment

The app deploys to **Azure Container Apps** via `.github/workflows/deploy.yml`,
gated behind CI. Auth is OIDC — no stored cloud credentials.

## How it works

Every push to `main` (or a manual **Run workflow**) runs three jobs:

1. **`ci`** — reuses `.github/workflows/ci.yml` (the `Validate` gate: lint, typecheck, `next build`, the integration tests, gitleaks, dependency-review). Red CI ⇒ build + deploy skipped.
2. **`build-and-push`** — OIDC login → Buildx build (gha cache) → push a SHA-tagged image to ACR.
3. **`deploy`** — OIDC login → sync app secrets (skip-on-unset) → check the three call-protection secrets → apply `.github/containerapp.yaml` (image injected via `envsubst`) → poll `GET /health` and `GET /health/analytics` on the new revision and public hostname until both return 200.

`concurrency: deploy-prod` with `cancel-in-progress: false` ensures a prod deploy is never cancelled mid-update.

## State / data

The per-number Call Me limits live in the existing storage account's `CallLimits` Azure Table. The table is shared by Container App revisions, so a deploy does not reset active-call reservations or the rolling 60-minute counts.

Workshop analytics events live in a separate `AnalyticsEvents` Azure Table, using the same `call-limit-storage` connection string. The app creates this table on first use and acknowledges browser events or feedback only after the Table write succeeds. Browser events and feedback keep stable IDs across retries, so a lost response does not inflate the dashboard. Successful calls are recorded immediately without delaying the call response; Twilio's signed status callback retries that event with the same Call SID-based ID. `/admin` replays the current run from Table into local SQLite at `data/analytics.db` for its existing SQL reports. That SQLite file is a disposable cache; it can be replaced without losing Table events. **Start New Run** rotates the current analytics generation and keeps prior runs in Table for recovery; `range=all` covers the current run. The `voiceaidata` Azure Files share remains mounted at `/app/appdata` for recovery snapshots, but the live SQLite file stays off the share because SQLite locking is unreliable over that mount.

Start a new run before attendees join. Open tabs and attendees returning with unsent events from closed tabs can still deliver earlier activity into the new run. Their audience selection may not be represented until they reload. Reset when the prior workshop is idle, and ask attendees to reload after an in-progress reset; events are never silently discarded based on their device clock.

The older analytics events that were written only to container-local SQLite before this change cannot be restored from a later revision. Preserve a SQLite online backup outside the running container immediately before replacing any revision that still holds such data; import a saved copy with `node analytics/import-snapshot.mjs /path/to/analytics.db --source <stable-source-id>` in an environment with `CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING` set. Use one distinct source ID for each original database, and reuse that ID for later snapshots of the same database **only if the old database was not reset between snapshots**. The old reset reused SQLite row IDs; if it ran, use a new source ID for later snapshots. Verify the imported row count in Table before switching production traffic. Do not import local development or synthetic test databases as production history.

## Prerequisites

One-time Azure provisioning + GitHub vars/secrets: run `./scripts/provision-azure.sh` (after `az login`) — see **[INFRA_SETUP.md](./INFRA_SETUP.md)**. Before deploying this version, run `./scripts/configure-call-protection.sh` to create `CallLimits` and `AnalyticsEvents` and set the Container App secrets for storage, organizer password, and `PUBLIC_BASE_URL`. The production call route requires the table connection and public HTTPS origin; `/admin` requires the password.

The public Call Me button allows one active call and ten started calls per number in a rolling 60 minutes, for valid US or Canadian destinations. This applies to both the hosted Explorer agent and Builder calls routed to an attendee's Codespace. The site fetches and checks the Builder's current `/twiml` response on each call, then sends the supported ConversationRelay settings to Twilio. It also checks the guided `/call-ended` response before any live handoff, allowing only one US or Canadian destination. Saved `workshop/server.js` changes are used on the next call.

The dedicated site's Twilio account should also allow only low-risk **United States/Canada** dialing in [Voice geographic permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources). This account setting is outside the app deploy and should be checked whenever the Twilio credentials change.

## Rollback

Re-run the deploy from a previous green commit (each image is SHA-tagged in ACR), or:
```bash
# edit containerapp.yaml's image, or:
az containerapp update -n voice-ai-workshop -g rg-voice-ai-workshop \
  --image voiceaiworkshop.azurecr.io/voice-ai-workshop:<previous-sha>
```

Choose an image that already uses `AnalyticsEvents` for durable writes. Older images write only to their container-local SQLite database; if you must use one, preserve and import its SQLite data before replacing that rollback revision.

## Health

`GET /health` → `{"status":"ok","uptime":<seconds>}` — unauthenticated, no dependency. This is the route taught in chapter-6; the deploy smoke-tests it.

`GET /health/analytics` → `{"status":"ok"}` when the current analytics run can be read from Azure Table storage, or 503 when it cannot. It exposes no attendee data. The deploy smoke-tests this separately from liveness.

The health check does not place a Twilio call. After deployment, make a test Explorer call and a Builder call from a running Codespace to check the live phone paths.
