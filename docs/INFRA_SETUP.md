# Infrastructure Setup (one-time)

The deploy workflow (`.github/workflows/deploy.yml`) ships the app but does **not**
create infrastructure or credentials. Do this once; afterward every push to `main`
deploys via OIDC — no stored cloud secret.

## Easy path — run the script

```bash
az login          # the correct subscription
gh auth status    # confirm GitHub auth
./scripts/provision-azure.sh
./scripts/configure-call-protection.sh
```

`scripts/provision-azure.sh` is idempotent: it creates the Azure resources
(RG, ACR, Container Apps env, a tagged Log Analytics workspace, a Storage account
+ an **Azure Files share** mounted by the app), the OIDC federated credential,
and sets the GitHub vars/secrets.
It adopts existing resources rather than inventing names, and prompts for the app
secrets (Twilio, OpenAI, slides URL, handoff number) — press Enter to skip any.

`scripts/configure-call-protection.sh` uses the existing storage account to create
the `CallLimits` table, then sets the Container App secrets for its connection
string, the organizer password, and the public HTTPS origin (`PUBLIC_BASE_URL`).
It prompts for a password of at least 16 characters, or you can provide one in
the `ADMIN_PASSWORD` environment variable. Keep that password out of the repo.
The default admin username is `presenter`. If your Azure resource names differ,
set `RG`, `ACA`, and `STORAGE` when running the script.

When both scripts finish: `gh workflow run deploy.yml`, watch the `Smoke test /health`
step, then `gh secret delete AZURE_CREDENTIALS` once green.

## What gets created / set

Azure: RG `rg-voice-ai-workshop`, ACR `voiceaiworkshop`, Container Apps env
`voiceaiworkshop`, Log Analytics `law-voiceaiworkshop`, Storage `voiceaiworkshop`
+ file share `voiceaidata` (mounted at `/app/appdata`), Azure Table `CallLimits`,
Container App `voice-ai-workshop`, a service principal `voice-ai-workshop-gha-deploy`
(AcrPush + Contributor) and a federated credential trusting
`repo:OWNER/REPO:ref:refs/heads/main`.

The call-protection script also sets Container App secrets `call-limit-storage`,
`admin-password`, and `public-base-url` before the manifest references them.
The public call route needs the table and public URL to work; `/admin` needs
the organizer password. Calls started from the workshop site accept US and
Canadian destinations, with one active call and ten starts per number in a
rolling 60 minutes. There is no site-wide daily cap.

On a dedicated workshop Twilio account, also set [Voice dialing geographic
permissions](https://www.twilio.com/docs/voice/api/dialing-permissions-resources)
to low-risk **United States/Canada** only, with both high-risk categories off.
Twilio calls this combined entry `US`. This is an account setting, so the Azure
setup script does not change it; verify it again before a group event or when
switching Twilio accounts.

GitHub **variables**: `ACR_NAME`, `ACA_NAME`, `ACA_RESOURCE_GROUP`.
GitHub **secrets**: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `OPENAI_API_KEY`,
`WORKSHOP_SLIDES_EMBED_URL`, `HANDOFF_PHONE_NUMBER`.

## Notes
- **Repository rename or transfer:** rerun `./scripts/provision-azure.sh`. It updates
  the existing `gha-main` federated credential to trust the repository's current
  `OWNER/REPO` subject.
- **Tenant tag policy:** every resource gets a `created_by` tag (RGs exempt);
  the script handles this, including a pre-created tagged Log Analytics workspace.
- **Workshop coupling:** the `/health` route the deploy smoke-tests is the same
  one chapter-6 teaches students to add to `server.mjs`. Keep them in sync.
- **Container manifest:** the app is deployed via `.github/containerapp.yaml`
  (env vars + secretRefs + the `appdata` Azure Files volume). The deploy injects
  the SHA-tagged image into it via `envsubst`.
- **Analytics storage:** the analytics SQLite database writes to local container
  disk and resets when the container is replaced. It does not use the Azure Files
  share because SQLite locking is unreliable there. The `CallLimits` Azure Table
  remains available across app revisions.
