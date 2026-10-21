#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Install cloudflared (used to expose port 8080 to Twilio without
# the GitHub Codespaces port-warning interstitial).
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared..."
  curl -fsSL \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /tmp/cloudflared
  sudo install -m 0755 /tmp/cloudflared /usr/local/bin/cloudflared
  rm /tmp/cloudflared
fi

# Keep the helper linked to this checkout so it picks up fixes without a rebuild.
sudo ln -sfn "$REPO_ROOT/.devcontainer/tunnel-url" /usr/local/bin/tunnel-url

# Install the exact workshop dependency versions from the lockfile.
cd "$REPO_ROOT/workshop"
npm ci

# Public attendees do not receive repository Codespaces secrets. Seed values
# from personal secrets when present; otherwise they fill .env after boot.
# Never replace an edited .env.
if [[ ! -e .env && ! -L .env ]]; then
  umask 077
  cat > .env <<EOF
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-}
TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
OPENAI_MODEL=${OPENAI_MODEL:-}
HANDOFF_PHONE_NUMBER=${HANDOFF_PHONE_NUMBER:-}

# Set this to your personal phone number in E.164 format
MY_PHONE_NUMBER=
EOF
fi
