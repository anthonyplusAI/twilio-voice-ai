#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${TUNNEL_STATE_DIR:-/tmp}"
LOG="$STATE_DIR/cloudflared.log"
PID_FILE="$STATE_DIR/cloudflared.pid"
URL_FILE="$STATE_DIR/cloudflared-url"
TUNNEL_BIN="${TUNNEL_CLOUDFLARED_BIN:-cloudflared}"
WAIT_SECONDS="${TUNNEL_WAIT_SECONDS:-30}"
umask 077

if [[ "${1:-}" == "--url" ]]; then
  ROUTE="${2:-twiml}"
  if [[ $# -gt 2 || ( "$ROUTE" != "twiml" && "$ROUTE" != "call" ) ]]; then
    echo "Usage: start-tunnel.sh [--url twiml|call]" >&2
    exit 2
  fi
elif [[ $# -ne 0 ]]; then
  echo "Usage: start-tunnel.sh [--url twiml|call]" >&2
  exit 2
fi
if [[ ! "$WAIT_SECONDS" =~ ^[0-9]+$ || "$WAIT_SECONDS" -eq 0 ]]; then
  echo "TUNNEL_WAIT_SECONDS must be a positive whole number" >&2
  exit 2
fi

mkdir -p "$STATE_DIR"

is_tunnel_running() {
  local pid state
  [[ -s "$PID_FILE" ]] || return 1
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [[ -r "/proc/$pid/stat" ]]; then
    read -r _ _ state _ < "/proc/$pid/stat" || return 1
    [[ "$state" != Z ]] || return 1
  fi
}

if ! is_tunnel_running; then
  rm -f "$PID_FILE" "$URL_FILE"
  : > "$LOG"

  # Quick Tunnel forwards a public HTTPS URL to the attendee's port 8080.
  nohup "$TUNNEL_BIN" tunnel \
    --url http://localhost:8080 \
    --no-autoupdate \
    > "$LOG" 2>&1 &
  printf '%s\n' "$!" > "$PID_FILE"
fi

# Always read the live process's log. A saved URL from an earlier tunnel is stale.
rm -f "$URL_FILE"
URL=""
for ((attempt = 0; attempt < WAIT_SECONDS; attempt++)); do
  if ! is_tunnel_running; then
    echo "cloudflared exited; check $LOG" >&2
    exit 1
  fi
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -n 1 || true)"
  if [[ -n "$URL" ]]; then
    printf '%s\n' "$URL" > "$URL_FILE"
    break
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "cloudflared has not printed a URL yet; check $LOG and run tunnel-url again" >&2
  if [[ "${1:-}" == "--url" ]]; then
    exit 1
  fi
  exit 0
fi

if [[ "${1:-}" == "--url" ]]; then
  printf '%s/%s\n' "$URL" "$ROUTE"
else
  cat <<BANNER

================================================================
  Public TwiML URL: ${URL}/twiml
  Paste that into the Call Me widget on the workshop page.
  Run \`tunnel-url\` for /twiml or \`tunnel-url call\` for /call.
================================================================

BANNER
fi
