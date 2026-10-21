#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${TUNNEL_STATE_DIR:-/tmp}"
LOG="$STATE_DIR/cloudflared.log"
PID_FILE="$STATE_DIR/cloudflared.pid"
URL_FILE="$STATE_DIR/cloudflared-url"
TARGET_FILE="$STATE_DIR/cloudflared-target"
PROXY_LOG="$STATE_DIR/workshop-proxy.log"
PROXY_PID_FILE="$STATE_DIR/workshop-proxy.pid"
TUNNEL_BIN="${TUNNEL_CLOUDFLARED_BIN:-cloudflared}"
WAIT_SECONDS="${TUNNEL_WAIT_SECONDS:-30}"
PROXY_PORT="${TUNNEL_PROXY_PORT:-8081}"
PROXY_TARGET="http://127.0.0.1:$PROXY_PORT"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077

if [[ "${1:-}" == "--url" ]]; then
  ROUTE="${2:-twiml}"
  if [[ $# -gt 2 || "$ROUTE" != "twiml" ]]; then
    echo "Usage: start-tunnel.sh [--url twiml]" >&2
    exit 2
  fi
elif [[ $# -ne 0 ]]; then
  echo "Usage: start-tunnel.sh [--url twiml]" >&2
  exit 2
fi
if [[ ! "$WAIT_SECONDS" =~ ^[0-9]+$ || "$WAIT_SECONDS" -eq 0 ]]; then
  echo "TUNNEL_WAIT_SECONDS must be a positive whole number" >&2
  exit 2
fi
if [[ ! "$PROXY_PORT" =~ ^[0-9]+$ || "$PROXY_PORT" -eq 0 || "$PROXY_PORT" -gt 65535 ]]; then
  echo "TUNNEL_PROXY_PORT must be a valid port" >&2
  exit 2
fi

mkdir -p "$STATE_DIR"

is_running() {
  local pid state pid_file="$1"
  [[ -s "$pid_file" ]] || return 1
  pid="$(cat "$pid_file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [[ -r "/proc/$pid/stat" ]]; then
    read -r _ _ state _ < "/proc/$pid/stat" || return 1
    [[ "$state" != Z ]] || return 1
  fi
}

if ! is_running "$PROXY_PID_FILE"; then
  rm -f "$PROXY_PID_FILE"
  : > "$PROXY_LOG"
  nohup node "$REPO_ROOT/workshop/secure-proxy.js" > "$PROXY_LOG" 2>&1 &
  printf '%s\n' "$!" > "$PROXY_PID_FILE"
fi

# The proxy can start before workshop/server.js exists. An HTTP 502 from its
# forwarded /health route still proves that the protective listener is ready.
PROXY_READY=false
for ((attempt = 0; attempt < 20; attempt++)); do
  if ! is_running "$PROXY_PID_FILE"; then
    echo "Workshop proxy exited; check $PROXY_LOG" >&2
    exit 1
  fi
  if curl -sS --max-time 1 -o /dev/null "$PROXY_TARGET/health" 2>/dev/null; then
    PROXY_READY=true
    break
  fi
  sleep 0.2
done
if [[ "$PROXY_READY" != true ]]; then
  echo "Workshop proxy is not listening; check $PROXY_LOG" >&2
  exit 1
fi

# Replace pre-upgrade tunnels that still exposed the attendee server directly.
if is_running "$PID_FILE" && [[ "$(cat "$TARGET_FILE" 2>/dev/null || true)" != "$PROXY_TARGET" ]]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

if ! is_running "$PID_FILE"; then
  rm -f "$PID_FILE" "$URL_FILE" "$TARGET_FILE"
  : > "$LOG"

  # Only the local proxy, never the attendee's /call route, faces the internet.
  nohup "$TUNNEL_BIN" tunnel \
    --url "$PROXY_TARGET" \
    --no-autoupdate \
    > "$LOG" 2>&1 &
  printf '%s\n' "$!" > "$PID_FILE"
  printf '%s\n' "$PROXY_TARGET" > "$TARGET_FILE"
fi

# Always read the live process's log. A saved URL from an earlier tunnel is stale.
rm -f "$URL_FILE"
URL=""
for ((attempt = 0; attempt < WAIT_SECONDS; attempt++)); do
  if ! is_running "$PID_FILE"; then
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
  Run \`tunnel-url\` again to get the current URL.
  With personal Twilio credentials, run \`npm run call\` in workshop/.
================================================================

BANNER
fi
